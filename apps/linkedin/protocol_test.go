package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

// A conversation as LinkedIn's messenger API returns it, trimmed to what is read. Names are made up.
const conversationJSON = `{
  "entityUrn": "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME,2-Q29udg==)",
  "title": "",
  "groupChat": false,
  "read": false,
  "lastActivityAt": 1761480000000,
  "lastReadAt": 1761470000000,
  "categories": ["INBOX", "PRIMARY_INBOX"],
  "conversationParticipants": [
    {"entityUrn": "urn:li:msg_messagingParticipant:urn:li:fsd_profile:ACoAAME",
     "participantType": {"member": {"firstName": {"text": "Test"}, "lastName": {"text": "Owner"}}}},
    {"entityUrn": "urn:li:msg_messagingParticipant:urn:li:fsd_profile:ACoAAOTHER",
     "participantType": {"member": {"firstName": {"text": " Sam "}, "lastName": {"text": "Example"}, "headline": {"text": "Broker"}}}},
    {"entityUrn": "urn:li:msg_messagingParticipant:urn:li:fsd_company:123",
     "participantType": {"organization": {"name": {"text": "Example Co"}}}}
  ],
  "messages": {"elements": [
    {"entityUrn": "urn:li:msg_message:(urn:li:fsd_profile:ACoAAME,2-TXNn)",
     "deliveredAt": 1761480000000,
     "body": {"text": "Is Thursday still good?"},
     "messageBodyRenderFormat": "DEFAULT",
     "sender": {"entityUrn": "urn:li:msg_messagingParticipant:urn:li:fsd_profile:ACoAAOTHER",
                "participantType": {"member": {"firstName": {"text": "Sam"}, "lastName": {"text": "Example"}}}},
     "renderContent": [{"file": {"name": "Offer.pdf", "mediaType": "application/pdf", "byteSize": 2048}}]}
  ]}
}`

func TestConversationFrom(t *testing.T) {
	var raw linkedingo.Conversation
	if err := json.Unmarshal([]byte(conversationJSON), &raw); err != nil {
		t.Fatal(err)
	}
	c := ConversationFrom(raw)
	if c.URN != "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME,2-Q29udg==)" {
		t.Errorf("urn %q", c.URN)
	}
	if c.Group || c.Read || c.LastActivityAt != 1761480000000 || c.LastReadAt != 1761470000000 {
		t.Errorf("flags or times wrong: %+v", c)
	}
	if len(c.Participants) != 3 {
		t.Fatalf("participants %d", len(c.Participants))
	}
	other := c.Participants[1]
	if other.ID != "ACoAAOTHER" || other.URN != "urn:li:fsd_profile:ACoAAOTHER" || other.Kind != "member" || other.FirstName != "Sam" || other.Headline != "Broker" {
		t.Errorf("member %+v", other)
	}
	org := c.Participants[2]
	if org.Kind != "organization" || org.URN != "urn:li:fsd_company:123" || org.Name != "Example Co" {
		t.Errorf("organization %+v", org)
	}
	if len(c.Messages) != 1 {
		t.Fatalf("messages %d", len(c.Messages))
	}
	m := c.Messages[0]
	if m.Text != "Is Thursday still good?" || m.DeliveredAt != 1761480000000 || m.Sender == nil || m.Sender.ID != "ACoAAOTHER" {
		t.Errorf("message %+v", m)
	}
	if m.ConversationURN != c.URN {
		t.Errorf("a message in a conversation takes its URN, got %q", m.ConversationURN)
	}
	if len(m.Files) != 1 || m.Files[0] != (File{Name: "Offer.pdf", MediaType: "application/pdf", Size: 2048}) {
		t.Errorf("files %+v", m.Files)
	}
}

func TestMessageFromMediaRecalledAndForwarded(t *testing.T) {
	m := MessageFrom(linkedingo.Message{
		EntityURN:               linkedingo.NewURN("urn:li:msg_message:(urn:li:fsd_profile:ACoAAME,2-AAA)"),
		MessageBodyRenderFormat: linkedingo.MessageBodyRenderFormatRecalled,
		RenderContent: []linkedingo.RenderContent{
			{VectorImage: &linkedingo.VectorImage{}},
			{Video: &linkedingo.VideoPlayMetadata{}},
			{Audio: &linkedingo.AudioMetadata{}},
			{ExternalMedia: &linkedingo.ExternalMedia{}},
			{ForwardedMessage: &linkedingo.ForwardedMessage{ForwardedBody: linkedingo.AttributedText{Text: "Passed on"}}},
		},
	})
	if m.Format != "RECALLED" {
		t.Errorf("format %q", m.Format)
	}
	if m.Text != "Passed on" {
		t.Errorf("a forwarded message's text is used when the body is empty, got %q", m.Text)
	}
	want := []string{"image/jpeg", "video/mp4", "audio/mp4", "image/gif"}
	if len(m.Files) != len(want) {
		t.Fatalf("files %+v", m.Files)
	}
	for i, f := range m.Files {
		if f.MediaType != want[i] {
			t.Errorf("file %d is %q, want %q", i, f.MediaType, want[i])
		}
	}
	if m.Sender != nil || m.ConversationURN != "" || m.DeliveredAt != 0 {
		t.Errorf("empty parts stay empty: %+v", m)
	}
}

func TestPersonFromEmpty(t *testing.T) {
	if _, ok := PersonFrom(linkedingo.MessagingParticipant{}); ok {
		t.Error("a participant without a URN names nobody")
	}
}

func TestMeFrom(t *testing.T) {
	var p linkedingo.UserProfile
	if err := json.Unmarshal([]byte(`{"miniProfile": {"firstName": "Test", "lastName": "Owner", "entityUrn": "urn:li:fs_miniProfile:ACoAAME"}}`), &p); err != nil {
		t.Fatal(err)
	}
	me := MeFrom(&p)
	if me.ID != "ACoAAME" || me.URN != "urn:li:fsd_profile:ACoAAME" || me.FirstName != "Test" {
		t.Errorf("me %+v", me)
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		err  error
		kind string
	}{
		{fmt.Errorf("wrapped: %w", linkedingo.ErrTokenInvalidated), KindBadCredentials},
		{&linkedingo.ResponseError{StatusCode: http.StatusUnauthorized}, KindBadCredentials},
		{&linkedingo.ResponseError{StatusCode: http.StatusFound}, KindBadCredentials},
		{&linkedingo.ResponseError{StatusCode: http.StatusTooManyRequests}, KindRateLimited},
		{fmt.Errorf("wrapped: %w", &linkedingo.ResponseError{StatusCode: 999}), KindRefused},
		{&linkedingo.ResponseError{StatusCode: http.StatusForbidden}, KindForbidden},
		{&linkedingo.ResponseError{StatusCode: http.StatusNotFound}, KindBadRequest},
		{&linkedingo.ResponseError{StatusCode: http.StatusInternalServerError}, KindFailed},
		{fmt.Errorf("dial tcp: refused"), KindFailed},
	}
	for _, c := range cases {
		if got := Classify(c.err); got.Kind != c.kind {
			t.Errorf("%v: got %s, want %s", c.err, got.Kind, c.kind)
		}
	}
	if got := Classify(&linkedingo.ResponseError{StatusCode: 999}); got.Status != 999 {
		t.Errorf("the status is kept: %+v", got)
	}
}

func TestWireFormat(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)
	w.Write(Done(7, map[string]any{"ok": true}))
	w.Write(Fail(8, &Error{Kind: KindRateLimited, Status: 429}))
	w.Write(Event{Event: "message", Message: &Message{URN: "urn:li:msg_message:1", Text: "<b>&</b>"}})
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	want := []string{
		`{"id":7,"ok":true,"result":{"ok":true}}`,
		`{"id":8,"ok":false,"error":{"kind":"rate_limited","status":429}}`,
		`{"event":"message","message":{"urn":"urn:li:msg_message:1","conversationUrn":"","deliveredAt":0,"text":"<b>&</b>"}}`,
	}
	if len(lines) != len(want) {
		t.Fatalf("lines %q", lines)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Errorf("line %d\n got %s\nwant %s", i, lines[i], want[i])
		}
	}
}

func TestRequestDecoding(t *testing.T) {
	var req Request
	if err := json.Unmarshal([]byte(`{"id":3,"cmd":"send","args":{"conversation":"urn:li:msg_conversation:(a,b)","text":"Hi","token":"t"}}`), &req); err != nil {
		t.Fatal(err)
	}
	var args sendArgs
	if err := json.Unmarshal(req.Args, &args); err != nil || req.ID != 3 || req.Cmd != "send" || args.Text != "Hi" || args.Token != "t" {
		t.Errorf("request %+v args %+v", req, args)
	}
}

func TestHandleWithoutNetwork(t *testing.T) {
	h := &Helper{out: NewWriter(&bytes.Buffer{})}
	ctx := context.Background()

	resp, stop := h.Handle(ctx, Request{ID: 1, Cmd: "conversations"})
	if resp.OK || resp.Error.Kind != KindBadRequest || stop {
		t.Errorf("nothing works before login: %+v", resp)
	}
	resp, _ = h.Handle(ctx, Request{ID: 2, Cmd: "login", Args: json.RawMessage(`{"cookies":"bcookie=x"}`)})
	if resp.OK || resp.Error.Kind != KindBadCredentials {
		t.Errorf("cookies without li_at and JSESSIONID are refused before any request: %+v", resp)
	}
	resp, _ = h.Handle(ctx, Request{ID: 3, Cmd: "login"})
	if resp.OK || resp.Error.Kind != KindBadRequest {
		t.Errorf("login needs cookies: %+v", resp)
	}
	resp, _ = h.Handle(ctx, Request{ID: 4, Cmd: "teleport"})
	if resp.OK || resp.Error.Kind != KindBadRequest || resp.ID != 4 {
		t.Errorf("unknown command: %+v", resp)
	}
	resp, stop = h.Handle(ctx, Request{ID: 5, Cmd: "stop"})
	if !resp.OK || !stop {
		t.Errorf("stop: %+v", resp)
	}
}

func TestEventFrom(t *testing.T) {
	msg := &linkedingo.DecoratedEvent{}
	msg.Payload.Data.DecoratedMessage = &linkedingo.DecoratedMessage{Result: linkedingo.Message{Body: linkedingo.AttributedText{Text: "Hello"}}}
	if ev := EventFrom(msg); ev == nil || ev.Event != "message" || ev.Message.Text != "Hello" {
		t.Errorf("message event %+v", ev)
	}
	typing := &linkedingo.DecoratedEvent{}
	typing.Payload.Data.DecoratedTypingIndicator = &linkedingo.DecoratedTypingIndicator{}
	if ev := EventFrom(typing); ev != nil {
		t.Errorf("typing is not passed on: %+v", ev)
	}
}
