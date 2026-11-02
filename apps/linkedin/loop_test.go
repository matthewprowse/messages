// konva-linkedin: LinkedIn messaging for Konva, over stdin and stdout.
// Copyright (C) 2026 Matthew Prowse
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// Affero General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It uses linkedingo from mautrix-linkedin
// (go.mau.fi/mautrix-linkedin), also under the AGPL. See LICENSE.

// Tests for loop.go: an over-long line does not end the helper, a stop reaches a command that is stuck, and
// uploads get longer than other commands.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

func TestReadLineSkipsOverLongLines(t *testing.T) {
	long := strings.Repeat("x", 300_000)
	r := bufio.NewReaderSize(strings.NewReader("{\"a\":1}\n"+long+"\r\nlast"), 4096)
	line, tooLong, err := readLine(r, 1000)
	if err != nil || tooLong || string(line) != `{"a":1}` {
		t.Fatalf("first line: %q %v %v", line, tooLong, err)
	}
	if _, tooLong, err = readLine(r, 1000); err != nil || !tooLong {
		t.Fatalf("the long line is reported, not fatal: %v %v", tooLong, err)
	}
	line, tooLong, err = readLine(r, 1000)
	if err != nil || tooLong || string(line) != "last" {
		t.Fatalf("reading goes on after it: %q %v %v", line, tooLong, err)
	}
	if _, _, err = readLine(r, 1000); err != io.EOF {
		t.Fatalf("then the end: %v", err)
	}
}

func TestServeAnswersAnOverLongLineAndKeepsGoing(t *testing.T) {
	var out bytes.Buffer
	h := &Helper{out: NewWriter(&out)}
	pr, pw := io.Pipe()
	done := make(chan struct{})
	go func() { h.Serve(context.Background(), pr); close(done) }()
	_, _ = io.WriteString(pw, strings.Repeat("y", maxLine+10)+"\n"+`{"id":7,"cmd":"teleport"}`+"\n")
	time.Sleep(100 * time.Millisecond) // a stop read ahead of them would cancel what is still queued
	_, _ = io.WriteString(pw, `{"id":8,"cmd":"stop"}`+"\n")
	<-done
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 4 { // ready, bad line, teleport, stop
		t.Fatalf("responses: %q", lines)
	}
	var bad, teleport Response
	_ = json.Unmarshal([]byte(lines[1]), &bad)
	_ = json.Unmarshal([]byte(lines[2]), &teleport)
	if bad.OK || bad.Error.Kind != KindBadRequest || teleport.ID != 7 || teleport.Error.Kind != KindBadRequest {
		t.Errorf("both are bad_request: %s %s", lines[1], lines[2])
	}
	if !strings.Contains(lines[3], `"id":8`) || !strings.Contains(lines[3], `"ok":true`) {
		t.Errorf("stop is answered: %s", lines[3])
	}
}

func TestStopEndsACommandThatIsStuck(t *testing.T) {
	var out bytes.Buffer
	h := &Helper{out: NewWriter(&out)}
	h.probeProfile = func(ctx context.Context, _ *linkedingo.StringCookieJar, _ loginArgs) (*linkedingo.UserProfile, error) {
		<-ctx.Done() // a request that never answers
		return nil, ctx.Err()
	}
	pr, pw := io.Pipe()
	done := make(chan struct{})
	go func() { h.Serve(context.Background(), pr); close(done) }()
	_, _ = io.WriteString(pw, `{"id":1,"cmd":"login","args":{"cookies":"li_at=x; JSESSIONID=ajax:1"}}`+"\n")
	time.Sleep(100 * time.Millisecond) // let the login reach its probe
	_, _ = io.WriteString(pw, `{"id":2,"cmd":"stop"}`+"\n")
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("stop did not get through a stuck command")
	}
	if !strings.Contains(out.String(), `"id":2`) {
		t.Errorf("stop is answered: %s", out.String())
	}
}

func TestCommandTimeoutIsLongerForUploads(t *testing.T) {
	plain := commandTimeout(Request{Cmd: "send", Args: json.RawMessage(`{"conversation":"c","text":"hi"}`)})
	upload := commandTimeout(Request{Cmd: "send", Args: json.RawMessage(`{"attachments":[{"path":"/x"}]}`)})
	if plain != shortTimeout || upload != uploadTimeout || commandTimeout(Request{Cmd: "conversations"}) != shortTimeout {
		t.Errorf("timeouts: %v %v", plain, upload)
	}
}

func TestCheckAttachmentsKeepsTheFileItChecked(t *testing.T) {
	root := t.TempDir()
	p := writeFile(t, root, "Plan.pdf", "checked")
	files, bad := checkAttachments([]attachmentArg{{Path: p, Name: "Plan.pdf", Kind: "file"}}, root)
	if bad != nil {
		t.Fatal(bad)
	}
	defer closeAttachments(files)
	// The path now names something else, but the upload reads the file that was checked.
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "other"), p); err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(files[0].file)
	if err != nil || string(got) != "checked" {
		t.Errorf("the opened file is used: %q %v", got, err)
	}
}
