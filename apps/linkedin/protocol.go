// konva-linkedin: LinkedIn messaging for Konva, over stdin and stdout.
// Copyright (C) 2026 Matthew Prowse
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// Affero General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It uses linkedingo from mautrix-linkedin
// (go.mau.fi/mautrix-linkedin), also under the AGPL. See LICENSE.

package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

// The wire format, one JSON object per line. README.md describes it.

// Request is a command from the worker.
type Request struct {
	ID   int64           `json:"id"`
	Cmd  string          `json:"cmd"`
	Args json.RawMessage `json:"args,omitempty"`
}

// Response answers one Request, by its ID.
type Response struct {
	ID     int64  `json:"id"`
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  *Error `json:"error,omitempty"`
}

// Error is why a command or the real-time stream failed, as a kind the worker acts on. It never carries
// what LinkedIn said, only the HTTP status when there was one.
type Error struct {
	Kind   string `json:"kind"`
	Status int    `json:"status,omitempty"`
}

// The kinds of Error.
const (
	KindBadCredentials = "bad_credentials" // the session is no longer valid: reconnect
	KindRateLimited    = "rate_limited"    // 429: slow down
	KindRefused        = "refused"         // 999: LinkedIn refused the request
	KindForbidden      = "forbidden"       // 403: not allowed, or the account is restricted
	KindBadRequest     = "bad_request"     // a command the worker should not have sent
	KindFailed         = "failed"          // anything else
)

// Event is something that happened without a command: from the real-time stream, or the helper itself.
type Event struct {
	Event        string        `json:"event"`
	Message      *Message      `json:"message,omitempty"`
	Conversation *Conversation `json:"conversation,omitempty"`
	Error        *Error        `json:"error,omitempty"`
}

// Person is a participant: a member, or a company page.
type Person struct {
	ID        string `json:"id"`
	URN       string `json:"urn"`
	Kind      string `json:"kind"` // member or organization
	FirstName string `json:"firstName,omitempty"`
	LastName  string `json:"lastName,omitempty"`
	Name      string `json:"name,omitempty"`
	Headline  string `json:"headline,omitempty"`
}

// File is an attachment's name, type and size. Its bytes are not fetched.
type File struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Size      int    `json:"size,omitempty"`
}

// Message is one message in a conversation.
type Message struct {
	URN             string  `json:"urn"`
	ConversationURN string  `json:"conversationUrn"`
	Sender          *Person `json:"sender,omitempty"`
	DeliveredAt     int64   `json:"deliveredAt"`
	Text            string  `json:"text"`
	Format          string  `json:"format,omitempty"` // DEFAULT, EDITED, RECALLED or SYSTEM
	Files           []File  `json:"files,omitempty"`
}

// Conversation is a conversation with its participants (you included) and the messages LinkedIn sent with it.
type Conversation struct {
	URN            string    `json:"urn"`
	Title          string    `json:"title,omitempty"`
	Group          bool      `json:"group"`
	Read           bool      `json:"read"`
	LastActivityAt int64     `json:"lastActivityAt"`
	LastReadAt     int64     `json:"lastReadAt,omitempty"`
	Categories     []string  `json:"categories,omitempty"`
	Participants   []Person  `json:"participants"`
	Messages       []Message `json:"messages,omitempty"`
}

const participantPrefix = "urn:li:msg_messagingParticipant:"

// urnString is a URN as text, or "" for an empty one (whose String would be ":").
func urnString(u linkedingo.URN) string {
	if u.IsEmpty() {
		return ""
	}
	return u.String()
}

// PersonFrom turns a messaging participant into a Person. ok is false when it names nobody.
func PersonFrom(p linkedingo.MessagingParticipant) (Person, bool) {
	id := p.EntityURN.ID()
	if id == "" {
		return Person{}, false
	}
	urn := strings.TrimPrefix(p.EntityURN.String(), participantPrefix)
	switch {
	case p.ParticipantType.Organization != nil:
		org := p.ParticipantType.Organization
		return Person{ID: id, URN: urn, Kind: "organization", Name: strings.TrimSpace(org.Name.Text)}, true
	default:
		person := Person{ID: id, URN: "urn:li:fsd_profile:" + id, Kind: "member"}
		if m := p.ParticipantType.Member; m != nil {
			person.FirstName = strings.TrimSpace(m.FirstName.Text)
			person.LastName = strings.TrimSpace(m.LastName.Text)
			person.Headline = strings.TrimSpace(m.Headline.Text)
		}
		return person, true
	}
}

// MeFrom turns your own profile into a Person.
func MeFrom(p *linkedingo.UserProfile) Person {
	id := p.MiniProfile.EntityURN.ID()
	return Person{
		ID:        id,
		URN:       "urn:li:fsd_profile:" + id,
		Kind:      "member",
		FirstName: strings.TrimSpace(p.MiniProfile.FirstName),
		LastName:  strings.TrimSpace(p.MiniProfile.LastName),
	}
}

func filesFrom(contents []linkedingo.RenderContent) []File {
	var files []File
	for _, c := range contents {
		switch {
		case c.File != nil:
			files = append(files, File{Name: c.File.Name, MediaType: c.File.MediaType, Size: c.File.ByteSize})
		case c.VectorImage != nil:
			files = append(files, File{Name: "Photo.jpg", MediaType: "image/jpeg"})
		case c.Video != nil:
			files = append(files, File{Name: "Video.mp4", MediaType: "video/mp4"})
		case c.Audio != nil:
			files = append(files, File{Name: "Voice Note.m4a", MediaType: "audio/mp4"})
		case c.ExternalMedia != nil:
			name := strings.TrimSpace(c.ExternalMedia.Title)
			if name == "" {
				name = "GIF"
			}
			files = append(files, File{Name: name, MediaType: "image/gif"})
		}
	}
	return files
}

// MessageFrom turns a message into a Message.
func MessageFrom(m linkedingo.Message) Message {
	out := Message{
		URN:             urnString(m.EntityURN),
		ConversationURN: urnString(m.ConversationURN),
		Text:            m.Body.Text,
		Format:          string(m.MessageBodyRenderFormat),
		Files:           filesFrom(m.RenderContent),
	}
	if out.ConversationURN == "" {
		out.ConversationURN = urnString(m.Conversation.EntityURN)
	}
	if !m.DeliveredAt.IsZero() {
		out.DeliveredAt = m.DeliveredAt.UnixMilli()
	}
	if sender, ok := PersonFrom(m.Sender); ok {
		out.Sender = &sender
	}
	if out.Text == "" {
		for _, c := range m.RenderContent {
			if c.ForwardedMessage != nil && c.ForwardedMessage.ForwardedBody.Text != "" {
				out.Text = c.ForwardedMessage.ForwardedBody.Text
				break
			}
		}
	}
	return out
}

// ConversationFrom turns a conversation into a Conversation.
func ConversationFrom(c linkedingo.Conversation) Conversation {
	out := Conversation{
		URN:          urnString(c.EntityURN),
		Title:        strings.TrimSpace(c.Title),
		Group:        c.GroupChat,
		Read:         c.Read,
		Categories:   c.Categories,
		Participants: []Person{},
	}
	if !c.LastActivityAt.IsZero() {
		out.LastActivityAt = c.LastActivityAt.UnixMilli()
	}
	if !c.LastReadAt.IsZero() {
		out.LastReadAt = c.LastReadAt.UnixMilli()
	}
	for _, p := range c.ConversationParticipants {
		if person, ok := PersonFrom(p); ok {
			out.Participants = append(out.Participants, person)
		}
	}
	for _, m := range c.Messages.Elements {
		msg := MessageFrom(m)
		if msg.ConversationURN == "" {
			msg.ConversationURN = out.URN
		}
		out.Messages = append(out.Messages, msg)
	}
	return out
}

// Conversations turns a page of conversations into Conversations.
func Conversations(list []linkedingo.Conversation) []Conversation {
	out := make([]Conversation, 0, len(list))
	for _, c := range list {
		out = append(out, ConversationFrom(c))
	}
	return out
}

// Classify turns a linkedingo error into an Error.
func Classify(err error) *Error {
	if errors.Is(err, linkedingo.ErrTokenInvalidated) {
		return &Error{Kind: KindBadCredentials}
	}
	var re *linkedingo.ResponseError
	if errors.As(err, &re) {
		switch status := re.StatusCode; {
		case status == http.StatusUnauthorized || status == http.StatusFound || status == http.StatusSeeOther:
			return &Error{Kind: KindBadCredentials, Status: status}
		case status == http.StatusTooManyRequests:
			return &Error{Kind: KindRateLimited, Status: status}
		case status == 999:
			return &Error{Kind: KindRefused, Status: status}
		case status == http.StatusForbidden:
			return &Error{Kind: KindForbidden, Status: status}
		case status >= 400 && status < 500:
			return &Error{Kind: KindBadRequest, Status: status}
		default:
			return &Error{Kind: KindFailed, Status: status}
		}
	}
	return &Error{Kind: KindFailed}
}

// Fail is the Response for a failed command.
func Fail(id int64, err *Error) Response {
	return Response{ID: id, OK: false, Error: err}
}

// Done is the Response for a command that worked.
func Done(id int64, result any) Response {
	return Response{ID: id, OK: true, Result: result}
}
