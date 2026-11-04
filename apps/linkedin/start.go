// konva-linkedin: LinkedIn messaging for Konva, over stdin and stdout.
// Copyright (C) 2026 Matthew Prowse
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// Affero General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It uses linkedingo from mautrix-linkedin
// (go.mau.fi/mautrix-linkedin), also under the AGPL. See LICENSE.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

// Starting a conversation: the first message to one member, who is named by a profile URL, a public
// identifier, a profile URN or a name. linkedingo can create a chat (NewChat) but only with the fixed text
// "New chat", so the same createMessage request is made here, with the real text and one recipient.

const (
	profilePrefix   = "urn:li:fsd_profile:"
	createMessageAt = "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage"
	messagingOrigin = "https://www.linkedin.com/messaging"
)

// The kinds of Error a start adds. Neither sends anything.
const (
	KindNotFound  = "not_found" // nobody on LinkedIn matched the profile
	KindAmbiguous = "ambiguous" // more than one person matched, so none was chosen
)

type startArgs struct {
	Profile string `json:"profile"`
	Text    string `json:"text"`
	Token   string `json:"token"`
	// Attachments are files the worker wrote in AttachmentDir, its staging folder for this send. With them the
	// text is optional.
	Attachments   []attachmentArg `json:"attachments,omitempty"`
	AttachmentDir string          `json:"attachmentDir,omitempty"`
}

// session is what a login was given, kept so a request the library does not offer can be made the way it
// makes its own: the same cookies, browser headers and page headers.
type session struct {
	jar          *linkedingo.StringCookieJar
	headers      http.Header
	pageInstance string
	xLiTrack     string
	me           Person
	// endpoint is where createMessage goes; empty is LinkedIn's. Tests point it elsewhere.
	endpoint string
}

// sharedTransport is the one connection pool for the requests this file and media.go make themselves, so a
// call reuses a connection instead of leaking one, and idle ones are closed.
var sharedTransport = &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	MaxIdleConns:          4,
	MaxIdleConnsPerHost:   2,
	IdleConnTimeout:       30 * time.Second,
	TLSHandshakeTimeout:   15 * time.Second,
	ResponseHeaderTimeout: 45 * time.Second,
}

// newSession is what a login keeps for start: the jar and headers the client signs in with, the page headers
// as the library will use them, and who the account is.
func newSession(jar *linkedingo.StringCookieJar, args loginArgs, me Person, endpoint string) *session {
	page, track := args.PageInstance, args.XLiTrack
	// The library drops a track that is not voyager-web's, with its page instance; the same is done here.
	var parsed map[string]any
	if track != "" && (json.Unmarshal([]byte(track), &parsed) != nil || parsed["mpName"] != "voyager-web") {
		page, track = "", ""
	}
	return &session{jar: jar, headers: args.Headers.Clone(), pageInstance: page, xLiTrack: track, me: me, endpoint: endpoint}
}

// ProfileRef is who a start is addressed to, as far as the input says.
type ProfileRef struct {
	// ID is the member's profile ID when the input was a URN, else empty.
	ID string
	// Name is the words to look for when the input was a profile URL, a public identifier or a name.
	Name string
}

// ParseProfile reads a profile URN (urn:li:fsd_profile:ACoAA...), a profile URL
// (https://www.linkedin.com/in/jane-doe-1a2b3c4d/), a public identifier (jane-doe) or a name (Jane Doe).
// ok is false for anything that names nobody.
func ParseProfile(input string) (ref ProfileRef, ok bool) {
	s := strings.TrimSpace(input)
	if s == "" {
		return ProfileRef{}, false
	}
	if strings.HasPrefix(s, profilePrefix) {
		id := strings.TrimPrefix(s, profilePrefix)
		if id == "" || strings.ContainsAny(id, " /?#:,()") {
			return ProfileRef{}, false
		}
		return ProfileRef{ID: id}, true
	}
	slug := s
	lower := strings.ToLower(s)
	if strings.Contains(lower, "linkedin.com") {
		raw := s
		if !strings.Contains(raw, "://") {
			raw = "https://" + raw
		}
		u, err := url.Parse(raw)
		if err != nil || !(u.Host == "linkedin.com" || strings.HasSuffix(u.Host, ".linkedin.com")) {
			return ProfileRef{}, false
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) < 2 || parts[0] != "in" || parts[1] == "" {
			return ProfileRef{}, false
		}
		slug = parts[1]
		if decoded, err := url.PathUnescape(slug); err == nil {
			slug = decoded
		}
	} else if strings.ContainsAny(s, "/:?#") {
		return ProfileRef{}, false
	}
	name := nameFromSlug(slug)
	if name == "" {
		return ProfileRef{}, false
	}
	return ProfileRef{Name: name}, true
}

// nameFromSlug is the words of a public identifier or a name, without the numbers and hex LinkedIn appends
// to an identifier ("jane-doe-1a2b3c4d" is "jane doe").
func nameFromSlug(slug string) string {
	words := strings.FieldsFunc(slug, func(r rune) bool { return r == '-' || r == '_' || r == '.' || unicode.IsSpace(r) })
	for len(words) > 1 && strings.IndexFunc(words[len(words)-1], unicode.IsDigit) >= 0 {
		words = words[:len(words)-1]
	}
	return strings.Join(words, " ")
}

var folder = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ä", "a", "ã", "a", "å", "a", "é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i", "ó", "o", "ò", "o", "ô", "o", "ö", "o", "õ", "o", "ø", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u", "ç", "c", "ñ", "n", "ß", "ss", "ý", "y", "ÿ", "y",
)

// foldName lowercases a name and drops accents and everything that is not a letter or digit, so
// "José Peña" and "jose-pena" compare equal.
func foldName(s string) string {
	var b strings.Builder
	for _, r := range folder.Replace(strings.ToLower(s)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// PickProfile chooses the one search result whose full name is the name asked for. Zero matches is
// not_found and several is ambiguous: a first message is never sent to a guess.
func PickProfile(results []linkedingo.SearchResult, name string) (Person, *Error) {
	want := foldName(name)
	var found []Person
	seen := map[string]bool{}
	for _, r := range results {
		id := r.ProfileURN.ID()
		if id == "" || seen[id] || foldName(r.FirstName+" "+r.LastName) != want {
			continue
		}
		seen[id] = true
		found = append(found, Person{ID: id, URN: profilePrefix + id, Kind: "member", FirstName: strings.TrimSpace(r.FirstName), LastName: strings.TrimSpace(r.LastName)})
	}
	switch len(found) {
	case 0:
		return Person{}, &Error{Kind: KindNotFound}
	case 1:
		return found[0], nil
	}
	return Person{}, &Error{Kind: KindAmbiguous}
}

// startPayload is the body of createMessage for a new conversation. No conversation URN is named, and
// hostRecipientUrns is the one person it is to.
type startPayload struct {
	Message                      startMessage `json:"message"`
	MailboxURN                   string       `json:"mailboxUrn"`
	TrackingID                   string       `json:"trackingId"`
	DedupeByClientGeneratedToken bool         `json:"dedupeByClientGeneratedToken"`
	HostRecipientURNs            []string     `json:"hostRecipientUrns"`
}

type startMessage struct {
	Body                linkedingo.SendMessageBody     `json:"body"`
	RenderContentUnions []linkedingo.SendRenderContent `json:"renderContentUnions,omitempty"`
	OriginToken         string                         `json:"originToken"`
}

// StartPayload builds the request body. token makes the request safe to repeat: LinkedIn drops a second
// message with the same token.
func StartPayload(meID, recipientID, text, token, tracking string) startPayload {
	return startPayload{
		Message:                      startMessage{Body: linkedingo.SendMessageBody{Text: text}, OriginToken: token},
		MailboxURN:                   profilePrefix + meID,
		TrackingID:                   tracking,
		DedupeByClientGeneratedToken: true,
		HostRecipientURNs:            []string{profilePrefix + recipientID},
	}
}

// defaultTrack is the X-LI-Track the library falls back to when a session has none.
const defaultTrack = `{"clientVersion":"` + linkedingo.ServiceVersion + `","mpVersion":"` + linkedingo.ServiceVersion + `","osName":"web","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":2,"displayWidth":2880,"displayHeight":1800}`

// request is the createMessage call, made like linkedingo makes its own requests. A single attempt: if
// the answer is lost the worker is told it may have gone out, and is never retried here.
func (s *session) request(ctx context.Context, payload startPayload) (*linkedingo.MessageSentResponse, error) {
	if s == nil || s.jar == nil {
		// No login behind this session: nothing is sent, and the answer is the one for a missing sign-in.
		return nil, &linkedingo.ResponseError{StatusCode: http.StatusUnauthorized}
	}
	endpoint := s.endpoint
	if endpoint == "" {
		endpoint = createMessageAt
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	header := s.headers.Clone() // a nil Header clones to nil, which has no User-Agent and is replaced below
	if header.Get("User-Agent") == "" {
		header = http.Header{"User-Agent": {linkedingo.UserAgent}, "Sec-Ch-Ua": {linkedingo.SecCHUserAgent}, "Sec-Ch-Ua-Platform": {linkedingo.SecCHPlatform}, "Sec-Ch-Ua-Mobile": {linkedingo.SecCHMobile}}
	}
	track := s.xLiTrack
	if track == "" {
		track = defaultTrack
	}
	page := s.pageInstance
	if page == "" {
		page = "urn:li:page:messaging_thread;" + uuid.NewString()
	}
	header.Set("Accept-Language", "en-US,en;q=0.9")
	header.Set("csrf-token", s.jar.GetCookie(linkedingo.LinkedInCookieJSESSIONID))
	header.Set("content-type", "text/plain;charset=UTF-8")
	header.Set("Referer", messagingOrigin+"/")
	header.Set("X-LI-Page-Instance", page)
	header.Set("X-LI-Track", track)
	header.Set("X-RestLI-Protocol-Version", "2.0.0")
	req.Header = header

	client := &http.Client{
		Transport: sharedTransport,
		Jar:       s.jar,
		Timeout:   60 * time.Second,
		// A redirect is LinkedIn sending the session to its sign-in page; it is read as the status.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, &linkedingo.ResponseError{StatusCode: resp.StatusCode}
	}
	var out linkedingo.MessageSentResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// StartResult is what a start answers with: the new conversation, you and the recipient in it, and the
// message that opened it.
func StartResult(me, to Person, sent Message) map[string]any {
	conv := Conversation{URN: sent.ConversationURN, Read: true, LastActivityAt: sent.DeliveredAt, Participants: []Person{me, to}, Messages: []Message{sent}}
	if sent.Sender == nil {
		sent.Sender = &me
		conv.Messages = []Message{sent}
	}
	return map[string]any{"conversation": conv, "message": sent}
}

// start sends the first message of a new conversation.
func (h *Helper) start(ctx context.Context, id int64, args startArgs) Response {
	ref, ok := ParseProfile(args.Profile)
	if !ok || (strings.TrimSpace(args.Text) == "" && len(args.Attachments) == 0) || args.Token == "" || h.session == nil {
		return Fail(id, &Error{Kind: KindBadRequest})
	}
	var files []attachment
	if len(args.Attachments) > 0 {
		root, bad := stagingRoot(args.AttachmentDir, os.TempDir())
		if bad != nil {
			return Fail(id, bad)
		}
		if files, bad = checkAttachments(args.Attachments, root); bad != nil {
			return Fail(id, bad)
		}
		defer closeAttachments(files)
	}
	to := Person{ID: ref.ID, URN: profilePrefix + ref.ID, Kind: "member"}
	if ref.ID == "" {
		results, err := h.client.Search(ctx, ref.Name)
		if err != nil {
			return Fail(id, Classify(err))
		}
		picked, perr := PickProfile(results, ref.Name)
		if perr != nil {
			return Fail(id, perr)
		}
		to = picked
	}
	if to.ID == h.session.me.ID {
		return Fail(id, &Error{Kind: KindBadRequest})
	}
	payload := StartPayload(h.session.me.ID, to.ID, args.Text, args.Token, uuid.NewString()[:16])
	if len(files) > 0 {
		// The first file opens the conversation with the text; any others follow as messages of their own.
		render, err := uploadFile(ctx, h.client, files[0])
		if err != nil {
			return Fail(id, Classify(err))
		}
		payload.Message.RenderContentUnions = []linkedingo.SendRenderContent{render}
	}
	sent, err := h.session.request(ctx, payload)
	if err != nil {
		return Fail(id, Classify(err))
	}
	m := MessageFrom(sent.Data)
	if m.ConversationURN == "" {
		if u := urnString(sent.Data.BackendConversationURN); u != "" {
			m.ConversationURN = u
		}
	}
	if m.ConversationURN == "" {
		return Fail(id, &Error{Kind: KindFailed})
	}
	var more []Message
	if len(files) > 1 {
		var err error
		if more, err = sendFiles(ctx, h.client, linkedingo.NewURN(m.ConversationURN), "", args.Token, files[1:], 1); err != nil {
			// The conversation and its first message exist: the worker is told some of it went.
			return Fail(id, &Error{Kind: KindPartial, Sent: 1 + len(more)})
		}
	}
	result := StartResult(h.session.me, to, m)
	if len(more) > 0 {
		conv := result["conversation"].(Conversation)
		conv.Messages = append(conv.Messages, more...)
		result["conversation"] = conv
	}
	return Done(id, result)
}
