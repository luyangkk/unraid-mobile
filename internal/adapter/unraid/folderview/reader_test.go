package folderview

import (
	"bytes"
	"context"
	"encoding/base64"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type engine struct{ raw docker.Raw }

func (e *engine) Read(context.Context) (docker.Raw, error) { return e.raw, nil }
func source() *engine {
	return &engine{raw: docker.Raw{Containers: []docker.RawContainer{
		{ID: "server", Name: "photos_server"}, {ID: "redis", Name: "photos_redis"}, {ID: "db", Name: "database", FolderName: "Photos"},
	}}}
}
func write(t *testing.T, root, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "docker.json"), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestVerifiedFolderView2Config(t *testing.T) {
	root := t.TempDir()
	write(t, root, `{"photos":{"name":"Photos","icon":"https://example.test/photos.png","containers":["photos_server","missing","photos_server"],"regex":"^photos_","actions":["PRIVATE SHELL"],"settings":{"custom_script":"PRIVATE"}}}`)
	raw, err := NewReader(source(), root).Read(context.Background())
	if err != nil || len(raw.Folders) != 1 {
		t.Fatalf("folders: %+v %v", raw, err)
	}
	f := raw.Folders[0]
	if f.ID != "folder-photos" || f.Name != "Photos" || f.IconURL != "https://example.test/photos.png" || f.MatchPattern != "^photos_" || strings.Join(f.ContainerIDs, ",") != "server,db" {
		t.Fatalf("folder: %+v", f)
	}
	if len(raw.Containers) != 3 {
		t.Fatal("underlying containers changed")
	}
	os.Remove(filepath.Join(root, "docker.json"))
	raw, err = NewReader(source(), root).Read(context.Background())
	if err != nil || len(raw.Folders) != 0 || len(raw.Containers) != 3 {
		t.Fatal("missing plugin broke Docker")
	}
}
func TestConfigOrderAndSafeIconReferences(t *testing.T) {
	for _, icon := range []string{"javascript:alert(1)", "file:///etc/passwd", "http://example.test/icon.png", "https://user:pass@example.test/icon.png", "/other/private.png"} {
		t.Run(icon, func(t *testing.T) {
			root := t.TempDir()
			write(t, root, `{"z":{"name":"First","icon":"`+icon+`","containers":["photos_server"]},"a":{"name":"Second","containers":["photos_redis"]}}`)
			raw, err := NewReader(source(), root).Read(context.Background())
			if err != nil || len(raw.Folders) != 2 || raw.Folders[0].ID != "folder-z" || raw.Folders[1].ID != "folder-a" || raw.Folders[0].IconURL != "" {
				t.Fatalf("unsafe or reordered: %+v %v", raw, err)
			}
		})
	}
}
func TestOptionalInvalidConfigKeepsContainerRows(t *testing.T) {
	for _, body := range []string{"null", "[]", "invalid", strings.Repeat(" ", maxConfigBytes+1), `{"bad":{"name":"","containers":["photos_server"]}}`} {
		root := t.TempDir()
		write(t, root, body)
		raw, err := NewReader(source(), root).Read(context.Background())
		if err != nil || len(raw.Containers) != 3 || len(raw.Folders) != 0 {
			t.Fatal("invalid metadata changed Docker availability")
		}
	}
	root := t.TempDir()
	other := filepath.Join(t.TempDir(), "secret.json")
	os.WriteFile(other, []byte(`{"x":{"name":"No","containers":["photos_server"]}}`), 0600)
	os.Symlink(other, filepath.Join(root, "docker.json"))
	raw, _ := NewReader(source(), root).Read(context.Background())
	if len(raw.Folders) != 0 {
		t.Fatal("followed metadata symlink")
	}
}

func TestInlinePNGIconUsesTheAuthenticatedCache(t *testing.T) {
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(imageData.Bytes())
	root := t.TempDir()
	write(t, root, `{"photos":{"name":"Photos","icon":"data:image/png;base64,`+encoded+`","containers":["photos_server"]}}`)
	raw, err := NewReader(source(), root).Read(context.Background())
	if err != nil || len(raw.Folders) != 1 || raw.Folders[0].IconURL != "" || !bytes.Equal(raw.Folders[0].IconPNG, imageData.Bytes()) {
		t.Fatal("inline PNG was not validated")
	}
	for _, ref := range []string{"data:image/svg+xml;base64," + encoded, "data:image/png;base64,bad"} {
		url, data := icon(ref)
		if url != "" || len(data) > 0 {
			t.Fatal("invalid data URI accepted")
		}
	}
}
