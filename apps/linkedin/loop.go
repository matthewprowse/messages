// konva-linkedin: LinkedIn messaging for Konva, over stdin and stdout.
// Copyright (C) 2026 Matthew Prowse
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// Affero General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It uses linkedingo from mautrix-linkedin
// (go.mau.fi/mautrix-linkedin), also under the AGPL. See LICENSE.

// The command loop: reads the worker's JSON lines, runs the commands one at a time, and lets a stop reach a
// command that is stuck. Split from main.go, which holds the commands themselves.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync/atomic"
	"time"
)

const (
	// uploadTimeout is generous because a video upload to LinkedIn is slow on a poor line.
	uploadTimeout = 5 * time.Minute
	shortTimeout  = 60 * time.Second
)

// commandTimeout is how long a command may run before it is given up on: long for one that uploads files, short
// for the rest, so one hung request cannot hold up every command behind it (and the stop).
func commandTimeout(req Request) time.Duration {
	switch req.Cmd {
	case "send", "start":
		var args struct {
			Attachments []json.RawMessage `json:"attachments"`
		}
		if json.Unmarshal(req.Args, &args) == nil && len(args.Attachments) > 0 {
			return uploadTimeout
		}
	}
	return shortTimeout
}

// setInflight records how to end the command being handled (nil when none is).
func (h *Helper) setInflight(cancel context.CancelFunc) {
	h.mu.Lock()
	h.inflight = cancel
	h.mu.Unlock()
}

// interrupt ends the command being handled, if any. Its response is then a cancelled or failed one.
func (h *Helper) interrupt() {
	h.mu.Lock()
	cancel := h.inflight
	h.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// readLine reads one line of at most max bytes. A longer line is read to its end and thrown away, with tooLong
// set, so the next call starts on the next command instead of the stream ending (bufio.Scanner stops for good
// on an over-long line). err is io.EOF once nothing is left.
func readLine(r *bufio.Reader, max int) (line []byte, tooLong bool, err error) {
	for {
		chunk, rerr := r.ReadSlice('\n')
		if !tooLong {
			if len(line)+len(chunk) > max {
				tooLong, line = true, nil
			} else {
				line = append(line, chunk...)
			}
		}
		if errors.Is(rerr, bufio.ErrBufferFull) {
			continue
		}
		if rerr != nil && (rerr != io.EOF || len(line) == 0 && !tooLong) {
			return nil, false, rerr
		}
		for len(line) > 0 && (line[len(line)-1] == '\n' || line[len(line)-1] == '\r') {
			line = line[:len(line)-1]
		}
		return line, tooLong, nil
	}
}

type queued struct {
	req     Request
	bad     bool // not JSON, or too long to read: answered bad_request without running
	skipped bool // a stop came after it, so it is not run
}

// Serve runs commands from in until stop or until in closes. Reading and running are separate so a stop is seen
// (and ends the command in flight) even while that command is stuck.
func (h *Helper) Serve(ctx context.Context, in io.Reader) {
	h.out.Write(Event{Event: "ready"})
	queue := make(chan *queued, 256)
	var stopping atomic.Bool
	go func() {
		defer close(queue)
		r := bufio.NewReaderSize(in, 64*1024)
		for {
			line, tooLong, err := readLine(r, maxLine)
			if err != nil {
				return
			}
			item := &queued{}
			if tooLong || json.Unmarshal(line, &item.req) != nil {
				item.bad = true
			} else if item.req.Cmd == "stop" {
				stopping.Store(true)
				h.interrupt()
			}
			queue <- item
		}
	}()
	for item := range queue {
		if item.bad {
			h.out.Write(Fail(0, &Error{Kind: KindBadRequest}))
			continue
		}
		if stopping.Load() && item.req.Cmd != "stop" {
			h.out.Write(Fail(item.req.ID, &Error{Kind: KindCancelled}))
			continue
		}
		resp, stop := h.Dispatch(ctx, item.req)
		if resp != nil {
			h.out.Write(resp)
		}
		if stop {
			return
		}
	}
	// stdin closed: the worker went away, so the session ends with it.
	h.endWait()
	h.dropClient()
}
