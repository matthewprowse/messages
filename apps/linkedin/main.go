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
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
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
	// What the login was given, for the requests the library does not offer (start).
	session *session
	// Seams for tests: how the probe asks who the cookies belong to, and where start sends. Nil is the real thing.
	probeProfile  func(ctx context.Context, jar *linkedingo.StringCookieJar, args loginArgs) (*linkedingo.UserProfile, error)
	startEndpoint string

	// A password sign-in in progress: where it is waiting, and the wait for approval in the app that runs
	// beside the command loop (it can take minutes, and another command may have to end it).
	mu         sync.Mutex
	checkpoint *linkedingo.PasswordCheckpoint
	cancelWait context.CancelFunc
	waitDone   chan struct{}
	// inflight ends the command being handled (see interrupt).
	inflight context.CancelFunc
}

type loginArgs struct {
	Cookies      string `json:"cookies"`
	XLiTrack     string `json:"xLiTrack"`
	PageInstance string `json:"pageInstance"`
	SyncToken    string `json:"syncToken"`
	// Headers are the browser headers (User-Agent and its companions) the cookies were created with. A
	// session signed in with a password has them; pasted cookies do not, and use the library's defaults.
	Headers http.Header `json:"headers"`
}

type signinArgs struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Proxy    string `json:"proxy"`
}

type codeArgs struct {
	Code string `json:"code"`
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
	// Attachments are files the worker wrote in AttachmentDir, its staging folder for this send. With them the
	// text is optional.
	Attachments   []attachmentArg `json:"attachments,omitempty"`
	AttachmentDir string          `json:"attachmentDir,omitempty"`
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
// (typing, reactions, deletions). A seen receipt becomes a seen event.
func EventFrom(e *linkedingo.DecoratedEvent) *Event {
	data := e.Payload.Data
	switch {
	case data.DecoratedMessage != nil:
		m := MessageFrom(data.DecoratedMessage.Result)
		return &Event{Event: "message", Message: &m}
	case data.DecoratedConversation != nil:
		c := ConversationFrom(data.DecoratedConversation.Result)
		return &Event{Event: "conversation", Conversation: &c}
	case data.DecoratedSeenReceipt != nil:
		r := data.DecoratedSeenReceipt.Result
		conversation := MessageFrom(r.Message).ConversationURN
		by := r.SeenByParticipant.EntityURN.ID()
		if conversation == "" || by == "" || r.SeenAt.IsZero() {
			return nil
		}
		return &Event{Event: "seen", ConversationURN: conversation, By: by, At: r.SeenAt.UnixMilli()}
	}
	return nil
}

// Handle runs one command and returns its response. stop reports whether the helper should exit.
func (h *Helper) Handle(ctx context.Context, req Request) (resp Response, stop bool) {
	// base outlives the command: a login's client and the realtime connection keep running on it. ctx ends with the
	// command, by its timeout or by interrupt (a stop arriving while it is stuck).
	base := ctx
	ctx, cancel := context.WithTimeout(base, commandTimeout(req))
	defer cancel()
	h.setInflight(cancel)
	defer h.setInflight(nil)
	switch req.Cmd {
	case "login", "signin", "code", "app", "another_way", "stop":
	default:
		if h.client == nil {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
	}
	switch req.Cmd {
	case "signin":
		var args signinArgs
		if json.Unmarshal(req.Args, &args) != nil || strings.TrimSpace(args.Email) == "" || args.Password == "" {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		httpClient, err := ProxyClient(args.Proxy)
		if err != nil {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		h.endWait()
		session, err := linkedingo.NewPasswordLoginClient(httpClient).Login(ctx, args.Email, args.Password)
		return h.signInResponse(req.ID, session, err), false

	case "code":
		var args codeArgs
		cp := h.current()
		if json.Unmarshal(req.Args, &args) != nil || cp == nil {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		h.endWait()
		session, err := cp.SubmitCode(ctx, strings.TrimSpace(args.Code))
		return h.signInResponse(req.ID, session, err), false

	case "another_way":
		cp := h.current()
		if cp == nil {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		h.endWait()
		session, err := cp.TryAnotherWay(ctx)
		return h.signInResponse(req.ID, session, err), false

	case "login":
		var args loginArgs
		if json.Unmarshal(req.Args, &args) != nil || strings.TrimSpace(args.Cookies) == "" {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		h.dropClient() // a new login replaces the old one, and a failed one leaves none
		jar, err := linkedingo.NewJarFromCookieHeader(gState.ReplaceAllString(args.Cookies, ""))
		if err != nil || jar.GetCookie("li_at") == "" || jar.GetCookie(linkedingo.LinkedInCookieJSESSIONID) == "" {
			return Fail(req.ID, &Error{Kind: KindBadCredentials}), false
		}
		probe := h.probeProfile
		if probe == nil {
			probe = probeProfile
		}
		profile, err := probe(ctx, jar, args)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		me := MeFrom(profile)
		if me.ID == "" {
			return Fail(req.ID, &Error{Kind: KindBadCredentials}), false
		}
		h.session = newSession(jar, args, me, h.startEndpoint)
		h.client = linkedingo.NewClient(base, linkedingo.NewURN(me.ID), jar, args.PageInstance, args.XLiTrack, args.SyncToken, h.handlers())
		h.client.SetBrowserHeaders(args.Headers)
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
		if json.Unmarshal(req.Args, &args) != nil || args.Conversation == "" || args.Token == "" || (strings.TrimSpace(args.Text) == "" && len(args.Attachments) == 0) {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		if len(args.Attachments) > 0 {
			root, bad := stagingRoot(args.AttachmentDir, os.TempDir())
			if bad != nil {
				return Fail(req.ID, bad), false
			}
			files, bad := checkAttachments(args.Attachments, root)
			if bad != nil {
				return Fail(req.ID, bad), false
			}
			defer closeAttachments(files)
			sent, err := sendFiles(ctx, h.client, linkedingo.NewURN(args.Conversation), args.Text, args.Token, files, 0)
			if err != nil {
				return sendFailure(req.ID, sent, err), false
			}
			return sendDone(req.ID, sent), false
		}
		sent, err := h.client.SendMessage(ctx, linkedingo.NewURN(args.Conversation), linkedingo.SendMessageBody{Text: args.Text}, nil, args.Token)
		if err != nil {
			return Fail(req.ID, Classify(err)), false
		}
		m := MessageFrom(sent.Data)
		return Done(req.ID, map[string]any{"message": m}), false

	case "picture":
		var args pictureArgs
		if json.Unmarshal(req.Args, &args) != nil {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		return h.picture(ctx, req.ID, args), false

	case "start":
		var args startArgs
		if json.Unmarshal(req.Args, &args) != nil {
			return Fail(req.ID, &Error{Kind: KindBadRequest}), false
		}
		return h.start(ctx, req.ID, args), false

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
			if err := h.client.RealtimeConnect(base); err != nil {
				return Fail(req.ID, Classify(err)), false
			}
			h.live = true
		}
		return Done(req.ID, map[string]any{}), false

	case "stop":
		h.endWait()
		h.dropClient()
		return Done(req.ID, map[string]any{}), true
	}
	return Fail(req.ID, &Error{Kind: KindBadRequest}), false
}

// dropClient ends the realtime connection of the current login, if any, and forgets the login, so a new one
// (or none) starts clean. A start made after it is refused until the next login.
func (h *Helper) dropClient() {
	if h.client != nil && h.live {
		h.client.RealtimeDisconnect()
	}
	h.client, h.session, h.live = nil, nil, false
}

// probeProfile asks LinkedIn who the cookies belong to, with the headers they were created with.
func probeProfile(ctx context.Context, jar *linkedingo.StringCookieJar, args loginArgs) (*linkedingo.UserProfile, error) {
	probe := linkedingo.NewClient(ctx, linkedingo.NewURN(""), jar, args.PageInstance, args.XLiTrack, "", linkedingo.Handlers{})
	// The session must look like the browser it was created in, so LinkedIn does not end it.
	probe.SetBrowserHeaders(args.Headers)
	return probe.GetCurrentUserProfile(ctx)
}

// Dispatch runs one command like Handle does, except that waiting for approval in the app answers later, from
// its own goroutine, so the commands that can end the wait (another way, stop) still get through. resp is nil
// when the answer comes later.
func (h *Helper) Dispatch(ctx context.Context, req Request) (resp *Response, stop bool) {
	if req.Cmd == "app" {
		return h.waitForApp(ctx, req), false
	}
	r, stop := h.Handle(ctx, req)
	return &r, stop
}

// current is where the sign-in is waiting, or nil.
func (h *Helper) current() *linkedingo.PasswordCheckpoint {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.checkpoint
}

// endWait ends a wait for approval in the app, if one is running, and returns once it has answered.
func (h *Helper) endWait() {
	h.mu.Lock()
	cancel, done := h.cancelWait, h.waitDone
	h.cancelWait, h.waitDone = nil, nil
	h.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
}

// waitForApp starts the wait for the sign-in to be approved in the LinkedIn app. Its answer is written when
// the wait ends: approved (done, or on to the next check), turned down, timed out or ended by another command.
func (h *Helper) waitForApp(ctx context.Context, req Request) *Response {
	cp := h.current()
	if cp == nil || cp.Kind() != linkedingo.PasswordCheckpointApp {
		r := Fail(req.ID, &Error{Kind: KindBadRequest})
		return &r
	}
	h.endWait()
	waitCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	h.mu.Lock()
	h.cancelWait, h.waitDone = cancel, done
	h.mu.Unlock()
	go func() {
		defer close(done)
		defer cancel()
		session, err := cp.WaitForApp(waitCtx)
		h.out.Write(h.signInResponse(req.ID, session, err))
	}()
	return nil
}

// signInResponse answers a sign-in command from what linkedingo returned: signed in, waiting at a check that
// asks for a code or an approval (a wrong code lands here too, marked rejected), or failed.
func (h *Helper) signInResponse(id int64, session *linkedingo.PasswordLoginSession, err error) Response {
	if err == nil && session != nil {
		h.mu.Lock()
		h.checkpoint = nil
		h.mu.Unlock()
		return Done(id, SessionResult(session))
	}
	var le *linkedingo.PasswordLoginError
	if errors.As(err, &le) {
		if cp := le.Checkpoint(); cp != nil {
			if state := CheckpointState(cp); state != nil {
				h.mu.Lock()
				h.checkpoint = cp
				h.mu.Unlock()
				if le.Kind == linkedingo.PasswordLoginRejected {
					state["rejected"] = true
				}
				return Done(id, state)
			}
		}
	}
	if err == nil {
		err = &linkedingo.PasswordLoginError{Kind: linkedingo.PasswordLoginBadResponse, Stage: "session"}
	}
	return Fail(id, ClassifySignIn(err))
}

func main() {
	out := NewWriter(os.Stdout)
	h := &Helper{out: out}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h.Serve(ctx, os.Stdin)
}
