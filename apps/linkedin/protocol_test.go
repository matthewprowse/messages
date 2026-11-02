package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
	seen := &linkedingo.DecoratedEvent{}
	receipt := `{"result": {"seenAt": 1700000000000,
	  "message": {"conversationUrn": "urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-abc)"},
	  "seenByParticipant": {"entityUrn": "urn:li:msg_messagingParticipant:urn:li:fsd_profile:SAM"}}}`
	seen.Payload.Data.DecoratedSeenReceipt = &linkedingo.DecoratedSeenReceipt{}
	if err := json.Unmarshal([]byte(receipt), seen.Payload.Data.DecoratedSeenReceipt); err != nil {
		t.Fatal(err)
	}
	if ev := EventFrom(seen); ev == nil || ev.Event != "seen" || ev.By != "SAM" || ev.At != 1700000000000 || ev.ConversationURN != "urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-abc)" {
		t.Errorf("seen event %+v", ev)
	}
	seen.Payload.Data.DecoratedSeenReceipt = &linkedingo.DecoratedSeenReceipt{}
	if ev := EventFrom(seen); ev != nil {
		t.Errorf("a receipt naming nobody is dropped: %+v", ev)
	}
	typing := &linkedingo.DecoratedEvent{}
	typing.Payload.Data.DecoratedTypingIndicator = &linkedingo.DecoratedTypingIndicator{}
	if ev := EventFrom(typing); ev != nil {
		t.Errorf("typing is not passed on: %+v", ev)
	}
}

func TestClassifySignIn(t *testing.T) {
	failed := func(kind linkedingo.PasswordLoginErrorKind) error {
		return &linkedingo.PasswordLoginError{Kind: kind, Stage: "authenticate", Status: 400}
	}
	cases := []struct {
		err  error
		kind string
	}{
		{failed(linkedingo.PasswordLoginRejected), KindRejected},
		{fmt.Errorf("wrapped: %w", failed(linkedingo.PasswordLoginBlocked)), KindBlocked},
		{failed(linkedingo.PasswordLoginRateLimited), KindRateLimited},
		{failed(linkedingo.PasswordLoginChallenge), KindChallenge},
		{failed(linkedingo.PasswordLoginUnavailable), KindUnavailable},
		{failed(linkedingo.PasswordLoginUnsupported), KindUnsupported},
		{failed(linkedingo.PasswordLoginBadResponse), KindFailed},
		{context.Canceled, KindCancelled},
		{fmt.Errorf("dial tcp: refused"), KindFailed},
	}
	for _, c := range cases {
		if got := ClassifySignIn(c.err); got.Kind != c.kind {
			t.Errorf("%v: got %s, want %s", c.err, got.Kind, c.kind)
		}
	}
	got := ClassifySignIn(&linkedingo.PasswordLoginError{Kind: linkedingo.PasswordLoginRejected, Stage: "app_approval_expired", Status: 200})
	if got.Stage != "app_approval_expired" || got.Status != 200 {
		t.Errorf("the stage and status are kept: %+v", got)
	}
}

func TestProxyClient(t *testing.T) {
	if c, err := ProxyClient("  "); c != nil || err != nil {
		t.Errorf("no proxy is the default client: %v %v", c, err)
	}
	for _, bad := range []string{"nonsense", "ftp://proxy.example:21", "http://"} {
		if _, err := ProxyClient(bad); err == nil {
			t.Errorf("%q is not a usable proxy", bad)
		}
	}
	client, err := ProxyClient("http://user:pass@127.0.0.1:8080")
	if err != nil || client == nil {
		t.Fatalf("proxy: %v %v", client, err)
	}
	req, _ := http.NewRequest(http.MethodGet, "https://www.linkedin.com/login", nil)
	proxy, err := client.Transport.(*http.Transport).Proxy(req)
	if err != nil || proxy == nil || proxy.Host != "127.0.0.1:8080" {
		t.Errorf("requests go through the proxy: %v %v", proxy, err)
	}
}

func TestSessionResult(t *testing.T) {
	jar := linkedingo.NewEmptyStringCookieJar()
	jar.SetCookies(linkedingo.CookieBaseURL, []*http.Cookie{{Name: "li_at", Value: "token"}, {Name: "JSESSIONID", Value: "ajax:1"}})
	headers := http.Header{"User-Agent": {"Mozilla/5.0 Test"}}
	result := SessionResult(&linkedingo.PasswordLoginSession{Cookies: jar, BrowserHeaders: headers})
	cookies, _ := result["cookies"].(string)
	if result["state"] != StateDone || !strings.Contains(cookies, "li_at=token") || !strings.Contains(cookies, "JSESSIONID=ajax:1") {
		t.Errorf("result %+v", result)
	}
	var buf bytes.Buffer
	NewWriter(&buf).Write(Done(9, result))
	if !strings.Contains(buf.String(), `"headers":{"User-Agent":["Mozilla/5.0 Test"]}`) {
		t.Errorf("the headers go over the wire as a map of lists: %s", buf.String())
	}
	// What comes back through login is the same session.
	back, err := linkedingo.NewJarFromCookieHeader(cookies)
	if err != nil || back.GetCookie("li_at") != "token" || back.GetCookie(linkedingo.LinkedInCookieJSESSIONID) != "ajax:1" {
		t.Errorf("cookie header does not round trip: %q %v", cookies, err)
	}
}

func TestCheckpointStateOfNothing(t *testing.T) {
	if CheckpointState(nil) != nil || CheckpointState(&linkedingo.PasswordCheckpoint{}) != nil {
		t.Error("a page that asks for neither a code nor an approval is not a state")
	}
}

func TestSignInCommandsNeedWhatTheyNeed(t *testing.T) {
	h := &Helper{out: NewWriter(&bytes.Buffer{})}
	ctx := context.Background()
	for _, req := range []Request{
		{ID: 1, Cmd: "signin"},
		{ID: 2, Cmd: "signin", Args: json.RawMessage(`{"email":"a@example.com"}`)},
		{ID: 3, Cmd: "signin", Args: json.RawMessage(`{"email":"a@example.com","password":"x","proxy":"ftp://p:1"}`)},
		{ID: 4, Cmd: "code", Args: json.RawMessage(`{"code":"123456"}`)},
		{ID: 5, Cmd: "another_way"},
		{ID: 6, Cmd: "app"},
	} {
		resp, stop := h.Dispatch(ctx, req)
		if resp == nil || resp.OK || resp.Error.Kind != KindBadRequest || resp.ID != req.ID || stop {
			t.Errorf("%s without a sign-in under way: %+v", req.Cmd, resp)
		}
	}
}

func TestSignInResponseFailures(t *testing.T) {
	h := &Helper{out: NewWriter(&bytes.Buffer{})}
	resp := h.signInResponse(4, nil, &linkedingo.PasswordLoginError{Kind: linkedingo.PasswordLoginRejected, Stage: "authenticate"})
	if resp.OK || resp.ID != 4 || resp.Error.Kind != KindRejected || resp.Error.Stage != "authenticate" {
		t.Errorf("a refused password is an error: %+v", resp)
	}
	resp = h.signInResponse(5, nil, &linkedingo.PasswordLoginError{Kind: linkedingo.PasswordLoginChallenge, Stage: "authenticate"})
	if resp.OK || resp.Error.Kind != KindChallenge {
		t.Errorf("a challenge with no code or approval to give is an error: %+v", resp)
	}
	resp = h.signInResponse(6, nil, nil)
	if resp.OK || resp.Error.Kind != KindFailed {
		t.Errorf("no session and no error is still a failure: %+v", resp)
	}
}

func TestLoginRequestCarriesBrowserHeaders(t *testing.T) {
	var args loginArgs
	if err := json.Unmarshal([]byte(`{"cookies":"li_at=a","headers":{"User-Agent":["Mozilla/5.0 Test"],"Sec-Ch-Ua-Platform":["\"macOS\""]}}`), &args); err != nil {
		t.Fatal(err)
	}
	if args.Headers.Get("User-Agent") != "Mozilla/5.0 Test" || args.Headers.Get("Sec-Ch-Ua-Platform") != `"macOS"` {
		t.Errorf("headers %+v", args.Headers)
	}
}

func TestParseProfile(t *testing.T) {
	for input, want := range map[string]ProfileRef{
		"urn:li:fsd_profile:ACoAAOTHER":                            {ID: "ACoAAOTHER"},
		"https://www.linkedin.com/in/sam-example-1a2b3c4d/":        {Name: "sam example"},
		"linkedin.com/in/sam-example?utm_source=share":             {Name: "sam example"},
		"https://za.linkedin.com/in/jos%C3%A9-pe%C3%B1a/details/x": {Name: "josé peña"},
		"sam-example":    {Name: "sam example"},
		"  Sam Example ": {Name: "Sam Example"},
		"sam-123":        {Name: "sam"},
	} {
		got, ok := ParseProfile(input)
		if !ok || got != want {
			t.Errorf("ParseProfile(%q) = %+v, %v; want %+v", input, got, ok, want)
		}
	}
	for _, input := range []string{"", "   ", "urn:li:fsd_profile:", "urn:li:fsd_profile:a/b", "https://example.com/in/sam", "https://www.linkedin.com/company/acme", "https://www.linkedin.com/in/", "https://evil.test/?linkedin.com/in/sam", "a/b"} {
		if got, ok := ParseProfile(input); ok {
			t.Errorf("ParseProfile(%q) = %+v, want nothing", input, got)
		}
	}
}

func TestPickProfile(t *testing.T) {
	result := func(id, first, last string) linkedingo.SearchResult {
		return linkedingo.SearchResult{ProfileURN: linkedingo.NewURN("urn:li:fsd_profile:" + id), FirstName: first, LastName: last}
	}
	got, err := PickProfile([]linkedingo.SearchResult{result("A1", "Sam", "Example"), result("B2", "Samantha", "Example"), result("C3", "Sam", "Examples")}, "sam example")
	if err != nil || got.ID != "A1" || got.URN != "urn:li:fsd_profile:A1" || got.Kind != "member" || got.FirstName != "Sam" {
		t.Errorf("one exact match: %+v, %+v", got, err)
	}
	if got, err := PickProfile([]linkedingo.SearchResult{result("A1", "José", "Peña")}, "jose pena"); err != nil || got.ID != "A1" {
		t.Errorf("accents fold: %+v, %+v", got, err)
	}
	if _, err := PickProfile([]linkedingo.SearchResult{result("A1", "Sam", "Example"), result("B2", "Sam", "Example")}, "Sam Example"); err == nil || err.Kind != KindAmbiguous {
		t.Errorf("two people with the name must not be guessed between: %+v", err)
	}
	if _, err := PickProfile([]linkedingo.SearchResult{result("A1", "Sam", "Example"), result("A1", "Sam", "Example")}, "Sam Example"); err != nil {
		t.Errorf("the same person twice is one person: %+v", err)
	}
	if _, err := PickProfile([]linkedingo.SearchResult{result("A1", "Sam", "Other")}, "Sam Example"); err == nil || err.Kind != KindNotFound {
		t.Errorf("no match: %+v", err)
	}
	if _, err := PickProfile(nil, "Sam Example"); err == nil || err.Kind != KindNotFound {
		t.Errorf("no results: %+v", err)
	}
}

func TestStartPayload(t *testing.T) {
	raw, err := json.Marshal(StartPayload("ACoAAME", "ACoAAOTHER", "Hello Sam", "outbox-1", "track"))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	msg := got["message"].(map[string]any)
	if msg["originToken"] != "outbox-1" || msg["body"].(map[string]any)["text"] != "Hello Sam" {
		t.Errorf("message %+v", msg)
	}
	if _, named := msg["conversationUrn"]; named {
		t.Errorf("a new conversation names none: %+v", msg)
	}
	if got["mailboxUrn"] != "urn:li:fsd_profile:ACoAAME" || got["dedupeByClientGeneratedToken"] != true {
		t.Errorf("payload %+v", got)
	}
	to := got["hostRecipientUrns"].([]any)
	if len(to) != 1 || to[0] != "urn:li:fsd_profile:ACoAAOTHER" {
		t.Errorf("recipients %+v", to)
	}
}

func TestStartRequest(t *testing.T) {
	var gotBody []byte
	var gotHeader http.Header
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotHeader = r.Header.Clone()
		w.WriteHeader(status)
		if status == http.StatusOK {
			fmt.Fprint(w, `{"value": {"entityUrn": "urn:li:msg_message:(urn:li:fsd_profile:ACoAAME,2-TXNn)", "deliveredAt": 1761480000000,
				"body": {"text": "Hello Sam"}, "backendConversationUrn": "urn:li:messagingThread:2-Q29udg==",
				"conversation": {"entityUrn": "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME,2-Q29udg==)"}}}`)
		}
	}))
	defer srv.Close()
	jar, err := linkedingo.NewJarFromCookieHeader(`li_at=secret; JSESSIONID="ajax:123"`)
	if err != nil {
		t.Fatal(err)
	}
	s := &session{jar: jar, headers: http.Header{"User-Agent": {"Mozilla/5.0 Test"}}, me: Person{ID: "ACoAAME", Kind: "member"}, endpoint: srv.URL}
	sent, err := s.request(context.Background(), StartPayload("ACoAAME", "ACoAAOTHER", "Hello Sam", "outbox-1", "track"))
	if err != nil {
		t.Fatal(err)
	}
	m := MessageFrom(sent.Data)
	if m.ConversationURN != "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME,2-Q29udg==)" || m.Text != "Hello Sam" {
		t.Errorf("message %+v", m)
	}
	if gotHeader.Get("User-Agent") != "Mozilla/5.0 Test" || gotHeader.Get("Csrf-Token") != "ajax:123" || gotHeader.Get("X-Li-Track") == "" || gotHeader.Get("X-Li-Page-Instance") == "" {
		t.Errorf("headers %+v", gotHeader)
	}
	if strings.Contains(string(gotBody), "li_at") || !strings.Contains(string(gotBody), "hostRecipientUrns") {
		t.Errorf("body %s", gotBody)
	}

	status = http.StatusForbidden
	_, err = s.request(context.Background(), StartPayload("ACoAAME", "ACoAAOTHER", "Hello", "outbox-2", "track"))
	if e := Classify(err); e.Kind != KindForbidden || e.Status != 403 {
		t.Errorf("a refusal is forbidden: %+v", e)
	}
	status = http.StatusFound
	_, err = s.request(context.Background(), StartPayload("ACoAAME", "ACoAAOTHER", "Hello", "outbox-3", "track"))
	if e := Classify(err); e.Kind != KindBadCredentials {
		t.Errorf("a redirect to sign-in is bad credentials: %+v", e)
	}
}

func TestStartResult(t *testing.T) {
	me := Person{ID: "ACoAAME", URN: "urn:li:fsd_profile:ACoAAME", Kind: "member"}
	to := Person{ID: "ACoAAOTHER", URN: "urn:li:fsd_profile:ACoAAOTHER", Kind: "member", FirstName: "Sam"}
	got := StartResult(me, to, Message{URN: "urn:li:msg_message:1", ConversationURN: "urn:li:msg_conversation:1", Text: "Hello", DeliveredAt: 5})
	conv := got["conversation"].(Conversation)
	sent := got["message"].(Message)
	if conv.URN != "urn:li:msg_conversation:1" || len(conv.Participants) != 2 || conv.Participants[1].ID != "ACoAAOTHER" || conv.Group {
		t.Errorf("conversation %+v", conv)
	}
	if sent.Sender == nil || sent.Sender.ID != "ACoAAME" || len(conv.Messages) != 1 || conv.Messages[0].Sender == nil {
		t.Errorf("you are the sender: %+v", sent)
	}
}

func TestStartNeedsWhatItNeeds(t *testing.T) {
	h := &Helper{out: NewWriter(&bytes.Buffer{})}
	ctx := context.Background()
	resp, _ := h.Handle(ctx, Request{ID: 1, Cmd: "start", Args: json.RawMessage(`{"profile":"sam-example","text":"Hi","token":"t"}`)})
	if resp.OK || resp.Error.Kind != KindBadRequest {
		t.Errorf("start before login: %+v", resp)
	}
	// With a session, a start still needs a person, some text and a token, and none of these reaches LinkedIn.
	h.client = linkedingo.NewClient(ctx, linkedingo.NewURN("ACoAAME"), linkedingo.NewEmptyStringCookieJar(), "", "", "", linkedingo.Handlers{})
	h.session = &session{me: Person{ID: "ACoAAME"}}
	for _, args := range []string{`{}`, `{"profile":"sam","text":"  ","token":"t"}`, `{"profile":"sam","text":"Hi"}`, `{"profile":"https://example.com/in/sam","text":"Hi","token":"t"}`, `{"profile":"urn:li:fsd_profile:ACoAAME","text":"Hi","token":"t"}`, `[]`} {
		resp, _ = h.Handle(ctx, Request{ID: 2, Cmd: "start", Args: json.RawMessage(args)})
		if resp.OK || resp.Error.Kind != KindBadRequest {
			t.Errorf("start %s: %+v", args, resp)
		}
	}
}

// A start goes through the real login handler: it fails before a login, works after one, and fails again
// once the login is dropped or replaced by one that does not work.
func TestStartAfterLogin(t *testing.T) {
	var sentBody []byte
	var sentHeader http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sentBody, _ = io.ReadAll(r.Body)
		sentHeader = r.Header.Clone()
		fmt.Fprint(w, `{"value": {"entityUrn": "urn:li:msg_message:(urn:li:fsd_profile:ACoAAME,2-TXNn)", "deliveredAt": 1761480000000,
			"body": {"text": "Hello Sam"}, "backendConversationUrn": "urn:li:messagingThread:2-Q29udg==",
			"conversation": {"entityUrn": "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME,2-Q29udg==)"}}}`)
	}))
	defer srv.Close()

	profileOK := true
	var seen loginArgs
	h := &Helper{out: NewWriter(io.Discard), startEndpoint: srv.URL}
	h.probeProfile = func(_ context.Context, _ *linkedingo.StringCookieJar, args loginArgs) (*linkedingo.UserProfile, error) {
		seen = args
		if !profileOK {
			return nil, &linkedingo.ResponseError{StatusCode: http.StatusUnauthorized}
		}
		var p linkedingo.UserProfile
		p.MiniProfile.EntityURN = linkedingo.NewURN("urn:li:fs_miniProfile:ACoAAME")
		return &p, nil
	}
	ctx := context.Background()
	startArgs := json.RawMessage(`{"profile":"urn:li:fsd_profile:ACoAAOTHER","text":"Hello Sam","token":"outbox-1"}`)

	resp, _ := h.Handle(ctx, Request{ID: 1, Cmd: "start", Args: startArgs})
	if resp.OK || resp.Error.Kind != KindBadRequest || sentBody != nil {
		t.Fatalf("a start before login is refused and sends nothing: %+v", resp)
	}

	login := json.RawMessage(`{"cookies":"li_at=secret; JSESSIONID=\"ajax:123\"","pageInstance":"urn:li:page:x;1","headers":{"User-Agent":["Mozilla/5.0 Login"]}}`)
	resp, _ = h.Handle(ctx, Request{ID: 2, Cmd: "login", Args: login})
	if !resp.OK || h.client == nil || h.session == nil || h.session.me.ID != "ACoAAME" || h.session.jar == nil {
		t.Fatalf("login: %+v session %+v", resp, h.session)
	}
	if seen.Headers.Get("User-Agent") != "Mozilla/5.0 Login" {
		t.Errorf("the probe got the browser headers: %+v", seen)
	}
	resp, _ = h.Handle(ctx, Request{ID: 3, Cmd: "start", Args: startArgs})
	if !resp.OK {
		t.Fatalf("start after login: %+v", resp.Error)
	}
	if sentHeader.Get("User-Agent") != "Mozilla/5.0 Login" || sentHeader.Get("Csrf-Token") != "ajax:123" {
		t.Errorf("start replays the login's headers and csrf token: %+v", sentHeader)
	}
	if !strings.Contains(string(sentBody), "ACoAAME") || !strings.Contains(string(sentBody), "ACoAAOTHER") {
		t.Errorf("body %s", sentBody)
	}

	profileOK = false
	resp, _ = h.Handle(ctx, Request{ID: 4, Cmd: "login", Args: login})
	if resp.OK || resp.Error.Kind != KindBadCredentials || h.session != nil || h.client != nil {
		t.Errorf("a failed login leaves no session: %+v", resp)
	}
	resp, _ = h.Handle(ctx, Request{ID: 5, Cmd: "start", Args: startArgs})
	if resp.OK {
		t.Errorf("start after a failed login: %+v", resp)
	}

	profileOK = true
	h.Handle(ctx, Request{ID: 6, Cmd: "login", Args: login})
	h.Handle(ctx, Request{ID: 7, Cmd: "stop"})
	if h.session != nil || h.client != nil {
		t.Errorf("stop clears the login")
	}
}

func TestSessionRequestWithoutLogin(t *testing.T) {
	var s *session
	_, err := s.request(context.Background(), StartPayload("a", "b", "t", "k", "tr"))
	if e := Classify(err); e.Kind != KindBadCredentials {
		t.Errorf("nil session: %+v", e)
	}
	s = &session{}
	_, err = s.request(context.Background(), StartPayload("a", "b", "t", "k", "tr"))
	if e := Classify(err); e.Kind != KindBadCredentials {
		t.Errorf("nil jar: %+v", e)
	}
	// Nil headers with a jar do not panic either; the library's defaults are used.
	jar, _ := linkedingo.NewJarFromCookieHeader(`li_at=x; JSESSIONID="ajax:1"`)
	s = &session{jar: jar, endpoint: "http://127.0.0.1:1/"}
	if _, err = s.request(context.Background(), StartPayload("a", "b", "t", "k", "tr")); err == nil {
		t.Errorf("an unreachable endpoint fails")
	}
}

func TestProxyClientReusesItsTransportAndTimesOut(t *testing.T) {
	a, _ := ProxyClient("http://127.0.0.1:8081")
	b, _ := ProxyClient("http://127.0.0.1:8081")
	if a != b {
		t.Error("the same proxy shares one client, so connections are not left behind per sign-in")
	}
	if a.Transport.(*http.Transport).ResponseHeaderTimeout <= 0 {
		t.Error("a silent proxy times out")
	}
	if c, _ := ProxyClient("http://127.0.0.1:8082"); c == a {
		t.Error("another proxy gets its own client")
	}
}
