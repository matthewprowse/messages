// konva-linkedin: LinkedIn messaging for Konva, over stdin and stdout.
// Copyright (C) 2026 Matthew Prowse
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// Affero General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It uses linkedingo from mautrix-linkedin
// (go.mau.fi/mautrix-linkedin), also under the AGPL. See LICENSE.

package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

// Sending files, and fetching a profile picture. Files are sent like the mautrix bridge sends them
// (pkg/connector/handlematrix.go): each is uploaded with UploadMedia, then goes in a message of its own as a
// file (images and documents) or a video render content. The worker writes the files to its temp folder
// and names them here; the helper runs on the same machine and reads them from there.

const (
	maxAttachments   = 10
	maxAttachmentLen = 100 << 20 // a sanity cap; the worker applies LinkedIn's own limit
	maxPictureBytes  = 2 << 20
)

// The kinds of attachment.
const (
	AttachImage = "image"
	AttachVideo = "video"
	AttachFile  = "file"
)

// KindPartial is a send of several files that stopped part way: Error.Sent of them are on LinkedIn.
const KindPartial = "partial"

type attachmentArg struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Kind string `json:"kind"`
}

// attachment is an attachmentArg that passed checkAttachments: its real path and size.
type attachment struct {
	path string
	name string
	mime string
	kind string
	size int
	// file is the file as opened by checkAttachments, so what is uploaded is what was checked and not whatever
	// the path names by then. Nil (tests) falls back to opening path. closeAttachments closes it.
	file *os.File
}

// closeAttachments closes the files checkAttachments opened.
func closeAttachments(files []attachment) {
	for _, a := range files {
		if a.file != nil {
			a.file.Close()
		}
	}
}

// stagingPrefix starts the name of every folder the worker stages a send's files in (linkedin/files.ts).
const stagingPrefix = "konva-linkedin-"

// stagingRoot is the folder a send's files must come from: the one the worker named, when it is a private
// (mode 0700) folder called konva-linkedin-* directly inside tmp, symbolic links followed. Anything else is a bad
// request, so a send can never read other files under the temp folder (another send's, or the iCloud session's).
func stagingRoot(dir, tmp string) (string, *Error) {
	bad := &Error{Kind: KindBadRequest}
	if dir == "" || !filepath.IsAbs(dir) || filepath.Clean(dir) != dir || !strings.HasPrefix(filepath.Base(dir), stagingPrefix) {
		return "", bad
	}
	realTmp, err := filepath.EvalSymlinks(tmp)
	if err != nil {
		return "", bad
	}
	real, err := filepath.EvalSymlinks(dir)
	if err != nil || filepath.Dir(real) != realTmp || !strings.HasPrefix(filepath.Base(real), stagingPrefix) {
		return "", bad
	}
	info, err := os.Lstat(real)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
		return "", bad
	}
	return real, nil
}

// checkAttachments validates every file before anything is uploaded, so a bad one sends nothing. A path must
// be absolute, and once symbolic links are followed, a regular file under root (the send's staging folder).
func checkAttachments(args []attachmentArg, root string) ([]attachment, *Error) {
	bad := &Error{Kind: KindBadRequest}
	if len(args) == 0 || len(args) > maxAttachments {
		return nil, bad
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, bad
	}
	out := make([]attachment, 0, len(args))
	// A bad file closes the ones already opened: the caller gets nothing to close.
	fail := func() ([]attachment, *Error) {
		closeAttachments(out)
		return nil, bad
	}
	for _, a := range args {
		switch a.Kind {
		case AttachImage, AttachVideo, AttachFile:
		default:
			return fail()
		}
		name := strings.TrimSpace(a.Name)
		if name == "" || !filepath.IsAbs(a.Path) {
			return fail()
		}
		real, err := filepath.EvalSymlinks(filepath.Clean(a.Path))
		if err != nil || !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
			return fail()
		}
		// Opened once and judged by the open file. O_NOFOLLOW refuses a link swapped in at the last step, and the
		// path must still lead to the same file, so a swapped folder is caught too.
		f, err := os.OpenFile(real, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return fail()
		}
		info, err := f.Stat()
		again, errAgain := filepath.EvalSymlinks(real)
		at, errAt := os.Stat(real)
		if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxAttachmentLen ||
			errAgain != nil || again != real || errAt != nil || !os.SameFile(info, at) {
			f.Close()
			return fail()
		}
		mime := strings.TrimSpace(a.Mime)
		if mime == "" {
			mime = "application/octet-stream"
		}
		out = append(out, attachment{path: real, name: name, mime: mime, kind: a.Kind, size: int(info.Size()), file: f})
	}
	return out, nil
}

// mediaAPI is the part of linkedingo.Client that sending files uses, so tests can stand in for it.
type mediaAPI interface {
	UploadMedia(ctx context.Context, t linkedingo.MediaUploadType, filename, contentType string, size int, r io.Reader) (linkedingo.URN, error)
	SendMessage(ctx context.Context, conversation linkedingo.URN, body linkedingo.SendMessageBody, render []linkedingo.SendRenderContent, token string) (*linkedingo.MessageSentResponse, error)
}

// fileToken is the token of the i-th message of a send. The first is the token itself, so a send of one file
// or of text behaves as before; the others are derived from it, so a retried send still dedupes file by file.
func fileToken(token string, i int) string {
	if i == 0 {
		return token
	}
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprintf("%s/%d", token, i))).String()
}

// uploadFile uploads one file and builds the render content that attaches it.
func uploadFile(ctx context.Context, api mediaAPI, a attachment) (linkedingo.SendRenderContent, error) {
	f := a.file
	if f == nil {
		var err error
		if f, err = os.Open(a.path); err != nil {
			return linkedingo.SendRenderContent{}, err
		}
		defer f.Close()
	}
	upload := linkedingo.MediaUploadTypeFileAttachment
	switch a.kind {
	case AttachImage:
		upload = linkedingo.MediaUploadTypePhotoAttachment
	case AttachVideo:
		upload = linkedingo.MediaUploadTypeVideoAttachment
	}
	urn, err := api.UploadMedia(ctx, upload, a.name, a.mime, a.size, f)
	if err != nil {
		return linkedingo.SendRenderContent{}, err
	}
	return renderFor(a, urn), nil
}

// renderFor is what the bridge sends for an uploaded file: a video carries stream details it cannot know (a
// placeholder blob address, no dimensions); an image or a document is a file.
func renderFor(a attachment, urn linkedingo.URN) linkedingo.SendRenderContent {
	if a.kind == AttachVideo {
		return linkedingo.SendRenderContent{Video: &linkedingo.SendVideo{
			Media:      urn,
			Thumbnail:  linkedingo.SendThumbnail{Artifacts: []linkedingo.SendArtifacts{{}}},
			TrackingID: urn,
			ProgressiveStreams: []linkedingo.SendProgressiveStreams{{
				MediaType:          a.mime,
				Size:               a.size,
				StreamingLocations: []linkedingo.SendURL{{URL: "blob:https://www.linkedin.com/" + uuid.NewString()}},
			}},
		}}
	}
	return linkedingo.SendRenderContent{File: &linkedingo.SendFile{AssetURN: urn, Name: a.name, MediaType: a.mime, ByteSize: a.size}}
}

// sendFiles uploads and sends the files to a conversation, one message each, the text with the first. It
// returns the messages that went out, and the error that stopped it, if any (the messages before it did go).
// first is the position of files[0] among the files of the send, which its token comes from.
func sendFiles(ctx context.Context, api mediaAPI, conversation linkedingo.URN, text, token string, files []attachment, first int) ([]Message, error) {
	var sent []Message
	for i, a := range files {
		render, err := uploadFile(ctx, api, a)
		if err != nil {
			return sent, err
		}
		body := linkedingo.SendMessageBody{}
		if i == 0 {
			body.Text = text
		}
		resp, err := api.SendMessage(ctx, conversation, body, []linkedingo.SendRenderContent{render}, fileToken(token, first+i))
		if err != nil {
			return sent, err
		}
		sent = append(sent, MessageFrom(resp.Data))
	}
	return sent, nil
}

// sendFailure is the Response for a send that stopped: partial when some of its messages are already on LinkedIn.
func sendFailure(id int64, sent []Message, err error) Response {
	if len(sent) > 0 {
		return Fail(id, &Error{Kind: KindPartial, Sent: len(sent)})
	}
	return Fail(id, Classify(err))
}

// sendDone is the Response for a send that finished: message is the first one sent, messages all of them.
func sendDone(id int64, sent []Message) Response {
	return Done(id, map[string]any{"message": sent[0], "messages": sent})
}

// Profile pictures

type pictureArgs struct {
	URL string `json:"url"`
}

// pictureHost reports whether a picture may be fetched from this address: LinkedIn's image servers, over
// HTTPS. The address comes from LinkedIn's own data, but nothing else is ever fetched.
func pictureHost(u *url.URL) bool {
	host := strings.ToLower(u.Hostname())
	return u.Scheme == "https" && (u.Port() == "" || u.Port() == "443") && u.User == nil && (host == "licdn.com" || strings.HasSuffix(host, ".licdn.com"))
}

// fetchPicture downloads a picture without any of the session's cookies, and returns it only if it is
// an image of at most maxPictureBytes. A redirect is not followed. The errors carry no address.
func fetchPicture(ctx context.Context, client *http.Client, u *url.URL) (data []byte, mediaType string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", errors.New("picture request")
	}
	req.Header.Set("Accept", "image/*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", errors.New("picture fetch")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", &linkedingo.ResponseError{StatusCode: resp.StatusCode}
	}
	mediaType = strings.ToLower(strings.TrimSpace(strings.SplitN(resp.Header.Get("Content-Type"), ";", 2)[0]))
	if !strings.HasPrefix(mediaType, "image/") {
		return nil, "", errors.New("picture type")
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, maxPictureBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxPictureBytes {
		return nil, "", errors.New("picture size")
	}
	return data, mediaType, nil
}

// pictureClient goes through the proxy of the environment, like the rest of the helper, and follows no redirect.
func pictureClient() *http.Client {
	return &http.Client{
		Transport:     sharedTransport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func (h *Helper) picture(ctx context.Context, id int64, args pictureArgs) Response {
	u, err := url.Parse(strings.TrimSpace(args.URL))
	if err != nil || !pictureHost(u) {
		return Fail(id, &Error{Kind: KindBadRequest})
	}
	data, mediaType, err := fetchPicture(ctx, pictureClient(), u)
	if err != nil {
		return Fail(id, Classify(err))
	}
	return Done(id, map[string]any{"data": base64.StdEncoding.EncodeToString(data), "type": mediaType})
}
