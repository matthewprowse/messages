// konva-linkedin: LinkedIn messaging for Konva, over stdin and stdout.
// Copyright (C) 2026 Matthew Prowse
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// Affero General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It uses linkedingo from mautrix-linkedin
// (go.mau.fi/mautrix-linkedin), also under the AGPL. See LICENSE.

// Command konva-linkedin speaks to LinkedIn for one account and nothing else. It reads commands as JSON
// lines on stdin and writes responses and events as JSON lines on stdout. It stores nothing, logs nothing
// and sends nothing it was not told to. README.md describes the protocol.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

const maxLine = 1 << 20 // a pasted cookie header can be long

// Writer writes one JSON value per line, from any goroutine.
type Writer struct {
	mu  sync.Mutex
	enc *json.Encoder
}

func NewWriter(w io.Writer) *Writer {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return &Writer{enc: enc}
}

func (w *Writer) Write(v any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.enc.Encode(v)
}

// Helper is one account's LinkedIn session.
type Helper struct {
	out    *Writer
	client *linkedingo.Client
	live   bool
}

type loginArgs struct {
	Cookies      string `json:"cookies"`
	XLiTrack     string `json:"xLiTrack"`
	PageInstance string `json:"pageInstance"`
	SyncToken    string `json:"syncToken"`
}

type conversationsArgs struct {
	Before int64 `json:"before"`
}

type messagesArgs struct {
	Conversation string `json:"conversation"`
	Before       int64  `json:"before"`
	Count        int    `json:"count"`
}

type sendArgs struct {
	Conversation string `json:"conversation"`
	Text         string `json:"text"`
	Token        string `json:"token"`
}

type readArgs struct {
	Conversation string `json:"conversation"`
}

// g_state is a Google sign-in cookie that does not parse as a cookie; the mautrix bridge drops it too.
var gState = regexp.MustCompile(`g_state={.*?};?`)

func (h *Helper) handlers() linkedingo.Handlers {
	return linkedingo.Handlers{
		Heartbeat: func(context.Context) { h.out.Write(Event{Event: "heartbeat"}) },
		ClientConnection: func(context.Context, *linkedingo.ClientConnection) {
			h.out.Write(Event{Event: "connected"})
		},
		TransientDisconnect: func(context.Context, error) { h.out.Write(Event{Event: "reconnecting"}) },
		BadCredentials: func(_ context.Context, err error) {
			h.out.Write(Event{Event: "bad_credentials", Error: &Error{Kind: KindBadCredentials}})
		},
		UnknownError: func(_ context.Context, err error) {
			h.out.Write(Event{Event: "failed", Error: Classify(err)})
		},
		DecoratedEvent: func(_ context.Context, e *linkedingo.DecoratedEvent) {
			if ev := EventFrom(e); ev != nil {
				h.out.Write(ev)
			}
		},
	}
}

// EventFrom turns a real-time event into the Event the worker hears, or nil for one it does not need
// (typing, seen receipts, reactions, deletions).
func EventFrom(e *linkedingo.DecoratedEvent) *Event {
	data := e.Payload.Data
	switch {
	case data.DecoratedMessage != nil:
		m := MessageFrom(data.DecoratedMessage.Result)
		return &Event{Event: "message", Message: &m}
	case data.DecoratedConversation != nil:
		c := ConversationFrom(data.DecoratedConversation.Result)
		return &Event{Event: "conversation", Conversation: &c}
	}
	return nil
}

// Handle runs one command and returns its response. stop reports whether the helper should exit.
func (h *Helper) Handle(ctx context.Context, req Request) (resp Response, stop bool) {
	if req.Cmd != "login" && req.Cmd != "stop" && h.client == nil {
		return Fail(req.ID, &Error{Kind: KindBadRequest}), false
	}
	switch req.Cmd {
	case "login":
		var args loginArgs
		if json.Unmarshal(req.Args, &args) != nil || strings.TrimSpace(args.Cookies) == "" {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		jar, err := linkedingo.NewJarFromCookieHeader(gState.ReplaceAllString(args.Cookies, ""))
		if err != nil || jar.GetCookie("li_at") == "" || jar.GetCookie(linkedingo.LinkedInCookieJSESSIONID) == "" {
			return Fail(req.ID, &Error{Kind: KindBadCredentials}), false
		}
		probe := linkedingo.NewClient(ctx, linkedingo.NewURN(""), jar, args.PageInstance, args.XLiTrack, "", linkedingo.Handlers{})
		profile, err := probe.GetCurrentUserProfile(ctx)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		me := MeFrom(profile)
		if me.ID == "" {
			return Fail(req.ID, &Error{Kind: KindBadCredentials}), false
		}
		h.client = linkedingo.NewClient(ctx, linkedingo.NewURN(me.ID), jar, args.PageInstance, args.XLiTrack, args.SyncToken, h.handlers())
		return Done(req.ID, map[string]any{"me": me}), false

	case "conversations":
		var args conversationsArgs
		_ = json.Unmarshal(req.Args, &args)
		before := time.Now()
		if args.Before > 0 {
			before = time.UnixMilli(args.Before)
		}
		page, err := h.client.GetConversationsUpdatedBefore(ctx, before)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		var list []linkedingo.Conversation
		if page != nil {
			list = page.Elements
		}
		return Done(req.ID, map[string]any{"conversations": Conversations(list)}), false

	case "changes":
		page, err := h.client.GetConversationsBySyncToken(ctx)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		result := map[string]any{"conversations": []Conversation{}, "deleted": []string{}, "syncToken": ""}
		if page != nil {
			deleted := []string{}
			for _, d := range page.Metadata.DeletedURNs {
				if s := urnString(d.Conversation.EntityURN); s != "" {
					deleted = append(deleted, s)
				}
			}
			result = map[string]any{"conversations": Conversations(page.Elements), "deleted": deleted, "syncToken": page.Metadata.NewSyncToken}
		}
		return Done(req.ID, result), false

	case "messages":
		var args messagesArgs
		if json.Unmarshal(req.Args, &args) != nil || args.Conversation == "" {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		before := time.Now()
		if args.Before > 0 {
			before = time.UnixMilli(args.Before)
		}
		count := args.Count
		if count <= 0 || count > 40 {
			count = 20
		}
		page, err := h.client.GetMessagesBefore(ctx, linkedingo.NewURN(args.Conversation), before, count)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		msgs := []Message{}
		if page != nil {
			for _, m := range page.Elements {
				msgs = append(msgs, MessageFrom(m))
			}
		}
		return Done(req.ID, map[string]any{"messages": msgs}), false

	case "send":
		var args sendArgs
		if json.Unmarshal(req.Args, &args) != nil || args.Conversation == "" || strings.TrimSpace(args.Text) == "" || args.Token == "" {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		sent, err := h.client.SendMessage(ctx, linkedingo.NewURN(args.Conversation), linkedingo.SendMessageBody{Text: args.Text}, nil, args.Token)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		m := MessageFrom(sent.Data)
		return Done(req.ID, map[string]any{"message": m}), false

	case "read":
		var args readArgs
		if json.Unmarshal(req.Args, &args) != nil || args.Conversation == "" {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		if _, err := h.client.MarkConversationRead(ctx, linkedingo.NewURN(args.Conversation)); err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		return Done(req.ID, map[string]any{}), false

	case "connect":
		if !h.live {
			if err := h.client.RealtimeConnect(ctx); err != nil {
				return Fail(req.ID, Classify(err)), false
			}
			h.live = true
		}
		return Done(req.ID, map[string]any{}), false

	case "stop":
		if h.client != nil && h.live {
			h.client.RealtimeDisconnect()
			h.live = false
		}
		return Done(req.ID, map[string]any{}), true
	}
	return Fail(req.ID, &Error{Kind: KindBadRequest}), false
}

func main() {
	out := NewWriter(os.Stdout)
	h := &Helper{out: out}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 64*1024), maxLine)
	out.Write(Event{Event: "ready"})
	for in.Scan() {
		var req Request
		if err := json.Unmarshal(in.Bytes(), &req); err != nil {
			out.Write(Fail(0, &Error{Kind: KindBadRequest}))
			continue
		}
		resp, stop := h.Handle(ctx, req)
		out.Write(resp)
		if stop {
			return
		}
	}
	// stdin closed: the worker went away, so the session ends with it.
	if h.client != nil && h.live {
		h.client.RealtimeDisconnect()
	}
}
