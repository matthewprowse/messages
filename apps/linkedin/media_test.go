package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.mau.fi/mautrix-linkedin/pkg/linkedingo"
)

type upload struct {
	kind linkedingo.MediaUploadType
	name string
	mime string
	size int
	data string
}

type sendCall struct {
	conversation string
	text         string
	render       []linkedingo.SendRenderContent
	token        string
}

// fakeAPI stands in for the LinkedIn client: nothing leaves the process.
type fakeAPI struct {
	uploads    []upload
	sends      []sendCall
	failUpload int // 1-based upload that fails, 0 for none
	failSend   int // 1-based send that fails, 0 for none
}

func (f *fakeAPI) UploadMedia(_ context.Context, t linkedingo.MediaUploadType, name, mime string, size int, r io.Reader) (linkedingo.URN, error) {
	data, _ := io.ReadAll(r)
	f.uploads = append(f.uploads, upload{t, name, mime, size, string(data)})
	if len(f.uploads) == f.failUpload {
		return linkedingo.URN{}, &linkedingo.ResponseError{StatusCode: 403}
	}
	return linkedingo.NewURN("urn:li:digitalmediaAsset:" + name), nil
}

func (f *fakeAPI) SendMessage(_ context.Context, c linkedingo.URN, body linkedingo.SendMessageBody, render []linkedingo.SendRenderContent, token string) (*linkedingo.MessageSentResponse, error) {
	f.sends = append(f.sends, sendCall{c.String(), body.Text, render, token})
	if len(f.sends) == f.failSend {
		return nil, errors.New("connection lost")
	}
	var resp linkedingo.MessageSentResponse
	_ = json.Unmarshal([]byte(`{"value":{"entityUrn":"urn:li:msg_message:(a,m`+string(rune('0'+len(f.sends)))+`)","body":{"text":"`+body.Text+`"}}}`), &resp)
	return &resp, nil
}

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCheckAttachments(t *testing.T) {
	root := t.TempDir()
	ok := writeFile(t, root, "Plan.pdf", "pdf")
	empty := writeFile(t, root, "Empty.txt", "")
	outside, err := os.MkdirTemp(".", "outside")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(outside)
	elsewhere, _ := filepath.Abs(writeFile(t, outside, "Secret.txt", "secret"))
	link := filepath.Join(root, "Link.txt")
	if err := os.Symlink(elsewhere, link); err != nil {
		t.Fatal(err)
	}

	got, bad := checkAttachments([]attachmentArg{{Path: ok, Name: " Plan.pdf ", Kind: "file"}}, root)
	if bad != nil || len(got) != 1 || got[0].name != "Plan.pdf" || got[0].size != 3 || got[0].mime != "application/octet-stream" {
		t.Errorf("a file under the temp folder is taken: %+v %+v", got, bad)
	}
	for name, a := range map[string]attachmentArg{
		"outside the temp folder": {Path: elsewhere, Name: "x", Kind: "file"},
		"a link out of it":        {Path: link, Name: "x", Kind: "file"},
		"a path going up":         {Path: filepath.Join(root, "..", filepath.Base(outside), "Secret.txt"), Name: "x", Kind: "file"},
		"relative":                {Path: "Plan.pdf", Name: "x", Kind: "file"},
		"the folder itself":       {Path: root, Name: "x", Kind: "file"},
		"missing":                 {Path: filepath.Join(root, "None"), Name: "x", Kind: "file"},
		"empty":                   {Path: empty, Name: "x", Kind: "file"},
		"no name":                 {Path: ok, Name: " ", Kind: "file"},
		"unknown kind":            {Path: ok, Name: "x", Kind: "audio"},
	} {
		if _, bad := checkAttachments([]attachmentArg{a}, root); bad == nil || bad.Kind != KindBadRequest {
			t.Errorf("%s must be a bad request: %+v", name, bad)
		}
	}
	if _, bad := checkAttachments(nil, root); bad == nil {
		t.Error("no files is a bad request")
	}
	many := make([]attachmentArg, maxAttachments+1)
	for i := range many {
		many[i] = attachmentArg{Path: ok, Name: "x", Kind: "file"}
	}
	if _, bad := checkAttachments(many, root); bad == nil {
		t.Error("too many files is a bad request")
	}
	// One bad file sends nothing: the check covers all of them first.
	if _, bad := checkAttachments([]attachmentArg{{Path: ok, Name: "x", Kind: "file"}, {Path: elsewhere, Name: "y", Kind: "file"}}, root); bad == nil {
		t.Error("a bad second file fails the whole send")
	}
}

func TestStagingRoot(t *testing.T) {
	tmp := t.TempDir()
	dir, err := os.MkdirTemp(tmp, "konva-linkedin-")
	if err != nil {
		t.Fatal(err)
	}
	realDir, _ := filepath.EvalSymlinks(dir)
	if got, bad := stagingRoot(dir, tmp); bad != nil || got != realDir {
		t.Errorf("the worker's private staging folder is the root: %q %+v", got, bad)
	}
	other, _ := os.MkdirTemp(tmp, "other-")
	open, _ := os.MkdirTemp(tmp, "konva-linkedin-")
	if err := os.Chmod(open, 0o755); err != nil {
		t.Fatal(err)
	}
	nested, _ := os.MkdirTemp(dir, "konva-linkedin-")
	elsewhere := t.TempDir()
	link := filepath.Join(tmp, "konva-linkedin-link")
	if err := os.Symlink(elsewhere, link); err != nil {
		t.Fatal(err)
	}
	for name, d := range map[string]string{
		"no folder":                "",
		"the temp folder itself":   tmp,
		"another folder":           other,
		"a folder others can read": open,
		"a folder deeper down":     nested,
		"a link out of the temp":   link,
		"relative":                 filepath.Base(dir),
		"a path going up":          dir + string(filepath.Separator) + ".." + string(filepath.Separator) + filepath.Base(dir),
		"missing":                  filepath.Join(tmp, "konva-linkedin-missing"),
	} {
		if _, bad := stagingRoot(d, tmp); bad == nil || bad.Kind != KindBadRequest {
			t.Errorf("%s must be a bad request: %+v", name, bad)
		}
	}
	// A file staged for one send cannot be sent by naming another send's folder as the root.
	ok := writeFile(t, dir, "0", "pdf")
	second, _ := os.MkdirTemp(tmp, "konva-linkedin-")
	root, _ := stagingRoot(second, tmp)
	if _, bad := checkAttachments([]attachmentArg{{Path: ok, Name: "x", Kind: "file"}}, root); bad == nil {
		t.Error("a file from another staging folder is a bad request")
	}
}

func TestSendFiles(t *testing.T) {
	root := t.TempDir()
	files := []attachment{
		{path: writeFile(t, root, "a.png", "PNG"), name: "Photo.png", mime: "image/png", kind: AttachImage, size: 3},
		{path: writeFile(t, root, "b.mp4", "MP4!"), name: "Clip.mp4", mime: "video/mp4", kind: AttachVideo, size: 4},
		{path: writeFile(t, root, "c.pdf", "PDF"), name: "Plan.pdf", mime: "application/pdf", kind: AttachFile, size: 3},
	}
	api := &fakeAPI{}
	sent, err := sendFiles(context.Background(), api, linkedingo.NewURN("urn:li:msg_conversation:1"), "Here you go", "row-token", files, 0)
	if err != nil || len(sent) != 3 {
		t.Fatalf("sent %d, %v", len(sent), err)
	}
	if api.uploads[0].kind != linkedingo.MediaUploadTypePhotoAttachment || api.uploads[1].kind != linkedingo.MediaUploadTypeVideoAttachment || api.uploads[2].kind != linkedingo.MediaUploadTypeFileAttachment {
		t.Errorf("upload types %+v", api.uploads)
	}
	if api.uploads[0].data != "PNG" || api.uploads[1].data != "MP4!" || api.uploads[2].name != "Plan.pdf" || api.uploads[2].mime != "application/pdf" {
		t.Errorf("uploads %+v", api.uploads)
	}
	if api.sends[0].text != "Here you go" || api.sends[1].text != "" || api.sends[2].text != "" {
		t.Errorf("the text goes with the first file only: %+v", api.sends)
	}
	if api.sends[0].token != "row-token" || api.sends[1].token == "row-token" || api.sends[1].token == api.sends[2].token {
		t.Errorf("tokens %q %q %q", api.sends[0].token, api.sends[1].token, api.sends[2].token)
	}
	// The same send again makes the same tokens, so LinkedIn drops what already went.
	again := &fakeAPI{}
	_, _ = sendFiles(context.Background(), again, linkedingo.NewURN("urn:li:msg_conversation:1"), "Here you go", "row-token", files, 0)
	if again.sends[1].token != api.sends[1].token || again.sends[2].token != api.sends[2].token {
		t.Error("tokens are not stable")
	}
	if f := api.sends[0].render[0].File; f == nil || f.Name != "Photo.png" || f.MediaType != "image/png" || f.ByteSize != 3 || f.AssetURN.String() == "" {
		t.Errorf("an image goes as a file: %+v", api.sends[0].render[0])
	}
	if v := api.sends[1].render[0].Video; v == nil || v.Media.IsEmpty() || len(v.ProgressiveStreams) != 1 || v.ProgressiveStreams[0].Size != 4 || !strings.HasPrefix(v.ProgressiveStreams[0].StreamingLocations[0].URL, "blob:https://www.linkedin.com/") {
		t.Errorf("a video: %+v", api.sends[1].render[0])
	}
}

func TestSendFilesStopsHonestly(t *testing.T) {
	root := t.TempDir()
	files := []attachment{
		{path: writeFile(t, root, "a.pdf", "A"), name: "A.pdf", mime: "application/pdf", kind: AttachFile, size: 1},
		{path: writeFile(t, root, "b.pdf", "B"), name: "B.pdf", mime: "application/pdf", kind: AttachFile, size: 1},
	}
	// The first upload fails: nothing went out, and the error is the upload's.
	api := &fakeAPI{failUpload: 1}
	sent, err := sendFiles(context.Background(), api, linkedingo.NewURN("c"), "Hi", "t", files, 0)
	if err == nil || len(sent) != 0 || len(api.sends) != 0 {
		t.Fatalf("sent %d, %v", len(sent), err)
	}
	if resp := sendFailure(1, sent, err); resp.OK || resp.Error.Kind != KindForbidden {
		t.Errorf("a refused upload is forbidden: %+v", resp.Error)
	}
	// The second fails: the first is on LinkedIn, and the answer says so.
	api = &fakeAPI{failUpload: 2}
	sent, err = sendFiles(context.Background(), api, linkedingo.NewURN("c"), "Hi", "t", files, 0)
	if err == nil || len(sent) != 1 {
		t.Fatalf("sent %d, %v", len(sent), err)
	}
	if resp := sendFailure(1, sent, err); resp.OK || resp.Error.Kind != KindPartial || resp.Error.Sent != 1 {
		t.Errorf("a send that stopped half way is partial: %+v", resp.Error)
	}
	// A send whose answer is lost is a plain failure, which the worker reads as maybe sent.
	api = &fakeAPI{failSend: 1}
	sent, err = sendFiles(context.Background(), api, linkedingo.NewURN("c"), "Hi", "t", files[:1], 0)
	if resp := sendFailure(1, sent, err); resp.OK || resp.Error.Kind != KindFailed {
		t.Errorf("a lost answer is failed: %+v", resp.Error)
	}
}

func TestSendNeedsTextOrFiles(t *testing.T) {
	h := &Helper{out: NewWriter(io.Discard)}
	h.client = linkedingo.NewClient(context.Background(), linkedingo.NewURN("ACoAAME"), linkedingo.NewEmptyStringCookieJar(), "", "", "", linkedingo.Handlers{})
	outside, _ := filepath.Abs("media_test.go")
	for _, args := range []string{
		`{"conversation":"c","token":"t"}`,
		`{"conversation":"c","text":" ","token":"t"}`,
		`{"conversation":"c","text":"Hi","token":"t","attachments":[{"path":"` + outside + `","name":"x","mime":"text/plain","kind":"file"}]}`,
		`{"conversation":"c","token":"t","attachments":[{"path":"relative","name":"x","kind":"file"}]}`,
	} {
		resp, _ := h.Handle(context.Background(), Request{ID: 1, Cmd: "send", Args: json.RawMessage(args)})
		if resp.OK || resp.Error.Kind != KindBadRequest {
			t.Errorf("send %s: %+v", args, resp)
		}
	}
}

func TestStartAcceptsFilesWithoutText(t *testing.T) {
	h := &Helper{out: NewWriter(io.Discard)}
	h.client = linkedingo.NewClient(context.Background(), linkedingo.NewURN("ACoAAME"), linkedingo.NewEmptyStringCookieJar(), "", "", "", linkedingo.Handlers{})
	h.session = &session{me: Person{ID: "ACoAAME"}}
	outside, _ := filepath.Abs("media_test.go")
	// Past the text check, a file outside the temp folder is still refused, before anything is uploaded.
	resp, _ := h.Handle(context.Background(), Request{ID: 1, Cmd: "start", Args: json.RawMessage(`{"profile":"urn:li:fsd_profile:ACoAAOTHER","token":"t","attachments":[{"path":"` + outside + `","name":"x","kind":"file"}]}`)})
	if resp.OK || resp.Error.Kind != KindBadRequest {
		t.Errorf("start with a bad file: %+v", resp)
	}
}

func TestStartPayloadCarriesFile(t *testing.T) {
	p := StartPayload("ME", "OTHER", "", "t", "track")
	p.Message.RenderContentUnions = []linkedingo.SendRenderContent{renderFor(attachment{name: "Plan.pdf", mime: "application/pdf", kind: AttachFile, size: 3}, linkedingo.NewURN("urn:li:asset:1"))}
	b, _ := json.Marshal(p)
	if !strings.Contains(string(b), `"renderContentUnions":[{"file":{"assetUrn":"urn:li:asset:1"`) {
		t.Errorf("payload %s", b)
	}
	b, _ = json.Marshal(StartPayload("ME", "OTHER", "Hi", "t", "track"))
	if strings.Contains(string(b), "renderContentUnions") {
		t.Errorf("a text-only start is unchanged: %s", b)
	}
}

func TestPersonPicture(t *testing.T) {
	var raw linkedingo.MessagingParticipant
	if err := json.Unmarshal([]byte(`{"entityUrn":"urn:li:msg_messagingParticipant:urn:li:fsd_profile:ACoAAOTHER",
		"participantType":{"member":{"firstName":{"text":"Sam"},"profilePicture":{"rootUrl":"https://media.licdn.com/dms/image/","artifacts":[
			{"width":100,"height":100,"fileIdentifyingUrlPathSegment":"small?e=1"},{"width":400,"height":400,"fileIdentifyingUrlPathSegment":"large?e=1"}]}}}}`), &raw); err != nil {
		t.Fatal(err)
	}
	p, ok := PersonFrom(raw)
	if !ok || p.Picture != "https://media.licdn.com/dms/image/large?e=1" {
		t.Errorf("the largest picture: %+v", p)
	}
	raw.ParticipantType.Member.ProfilePicture = nil
	if p, _ := PersonFrom(raw); p.Picture != "" {
		t.Errorf("no picture: %+v", p)
	}
	raw.ParticipantType.Member.ProfilePicture = &linkedingo.VectorImage{RootURL: "https://media.licdn.com/"}
	if p, _ := PersonFrom(raw); p.Picture != "" {
		t.Errorf("no versions, no picture: %+v", p)
	}
}

func TestPictureHost(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://media.licdn.com/dms/image/x?e=1": true,
		"https://licdn.com/x":                     true,
		"http://media.licdn.com/x":                false,
		"https://media.licdn.com:8443/x":          false,
		"https://evil.example.com/x":              false,
		"https://licdn.com.evil.example/x":        false,
		"https://notlicdn.com/x":                  false,
		"https://user@media.licdn.com/x":          false,
		"https://127.0.0.1/x":                     false,
	} {
		u, _ := url.Parse(raw)
		if got := pictureHost(u); got != want {
			t.Errorf("%s: %v", raw, got)
		}
	}
}

func TestFetchPicture(t *testing.T) {
	var cookie, typ string
	var body string
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie = r.Header.Get("Cookie")
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/ok", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", typ)
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL + "/ok")
	typ, body = "image/jpeg; charset=x", "JPEGDATA"
	data, mt, err := fetchPicture(context.Background(), pictureClient(), u)
	if err != nil || string(data) != "JPEGDATA" || mt != "image/jpeg" || cookie != "" {
		t.Errorf("a picture: %q %q %v cookie %q", data, mt, err, cookie)
	}
	typ = "text/html"
	if _, _, err := fetchPicture(context.Background(), pictureClient(), u); err == nil {
		t.Error("only images")
	}
	typ, body = "image/png", strings.Repeat("x", maxPictureBytes+1)
	if _, _, err := fetchPicture(context.Background(), pictureClient(), u); err == nil {
		t.Error("a large picture is refused")
	}
	typ, body = "image/png", "x"
	status = http.StatusNotFound
	if _, _, err := fetchPicture(context.Background(), pictureClient(), u); Classify(err).Kind != KindBadRequest {
		t.Errorf("a 404: %v", err)
	}
	status = http.StatusOK
	r, _ := url.Parse(srv.URL + "/redirect")
	if _, _, err := fetchPicture(context.Background(), pictureClient(), r); err == nil {
		t.Error("a redirect is not followed")
	}
	h := &Helper{out: NewWriter(io.Discard)}
	if resp := h.picture(context.Background(), 1, pictureArgs{URL: srv.URL + "/ok"}); resp.OK || resp.Error.Kind != KindBadRequest {
		t.Errorf("only LinkedIn's image servers: %+v", resp)
	}
}
