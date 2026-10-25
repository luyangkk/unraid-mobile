package dockericons

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
)

type engine struct {
	raw   docker.Raw
	calls int
}

func (e *engine) Read(context.Context) (docker.Raw, error) { e.calls++; return e.raw, nil }
func pngBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func write(t *testing.T, root, name string, data []byte) {
	t.Helper()
	filename := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, data, 0600); err != nil {
		t.Fatal(err)
	}
}
func TestReadIconsFromVerifiedMetadata(t *testing.T) {
	root := t.TempDir()
	data := pngBytes(t)
	write(t, root, "docker.json", []byte(`{"Plex":{"icon":"/state/plugins/dynamix.docker.manager/images/Plex-icon.png","url":"PRIVATE","secret":"PRIVATE"}}`))
	write(t, root, "images/Plex-icon.png", data)
	source := &engine{raw: docker.Raw{Containers: []docker.RawContainer{{ID: "id", Name: "Plex", State: "running"}}}}
	reader := NewReader(source, root)
	got, err := reader.Read(context.Background())
	if err != nil || len(got.Containers) != 1 || !bytes.Equal(got.Containers[0].IconPNG, data) || source.calls != 1 {
		t.Fatalf("read: %+v %v", got, err)
	}
	// Every background sample observes removal; no previous image survives a missing file.
	os.Remove(filepath.Join(root, "images/Plex-icon.png"))
	got, err = reader.Read(context.Background())
	if err != nil || len(got.Containers[0].IconPNG) != 0 {
		t.Fatal("retained removed icon")
	}
}
func TestIconsAreOptionalAndConfined(t *testing.T) {
	for _, ref := range []string{"https://example.invalid/icon.png", "/etc/passwd", "/state/plugins/dynamix.docker.manager/images/../../private.png", "/state/plugins/dynamix.docker.manager/images/a/b.png", "/state/plugins/dynamix.docker.manager/images/evil.svg", "/state/plugins/dynamix.docker.manager/images/escape.png"} {
		t.Run(ref, func(t *testing.T) {
			root := t.TempDir()
			write(t, root, "docker.json", []byte(`{"Plex":{"icon":"`+ref+`"}}`))
			write(t, root, "images/keep.png", pngBytes(t))
			outside := filepath.Join(t.TempDir(), "private.png")
			os.WriteFile(outside, pngBytes(t), 0600)
			if err := os.Symlink(outside, filepath.Join(root, "images/escape.png")); err != nil {
				t.Fatal(err)
			}
			source := &engine{raw: docker.Raw{Containers: []docker.RawContainer{{ID: "id", Name: "Plex"}}}}
			got, err := NewReader(source, root).Read(context.Background())
			if err != nil || len(got.Containers) != 1 || len(got.Containers[0].IconPNG) != 0 {
				t.Fatalf("unsafe icon: %+v %v", got, err)
			}
		})
	}
	for _, contents := range [][]byte{nil, []byte("invalid json"), []byte(strings.Repeat(" ", maxMetadataBytes+1))} {
		root := t.TempDir()
		if contents != nil {
			write(t, root, "docker.json", contents)
		}
		source := &engine{raw: docker.Raw{Containers: []docker.RawContainer{{Name: "Plex"}}}}
		got, err := NewReader(source, root).Read(context.Background())
		if err != nil || len(got.Containers) != 1 || len(got.Containers[0].IconPNG) != 0 {
			t.Fatal("optional metadata broke container collection")
		}
	}
}
func TestRejectInvalidOrOversizedImages(t *testing.T) {
	for _, contents := range [][]byte{[]byte("<svg onload='bad()'/>"), append(pngBytes(t), make([]byte, maxIconBytes)...)} {
		root := t.TempDir()
		write(t, root, "docker.json", []byte(`{"Plex":{"icon":"/state/plugins/dynamix.docker.manager/images/Plex-icon.png"}}`))
		write(t, root, "images/Plex-icon.png", contents)
		source := &engine{raw: docker.Raw{Containers: []docker.RawContainer{{Name: "Plex"}}}}
		got, err := NewReader(source, root).Read(context.Background())
		if err != nil || len(got.Containers[0].IconPNG) != 0 {
			t.Fatal("invalid image accepted")
		}
	}
}

// TestSampleBudget bounds total image bytes, including repeated metadata references.
func TestSampleBudget(t *testing.T) {
	root := t.TempDir()
	data := append(pngBytes(t), make([]byte, maxIconBytes-100)...)
	write(t, root, "images/shared.png", data)
	metadata := map[string]map[string]string{}
	source := &engine{}
	for i := 0; i < 20; i++ {
		name := fmt.Sprintf("app%d", i)
		source.raw.Containers = append(source.raw.Containers, docker.RawContainer{Name: name})
		metadata[name] = map[string]string{"icon": iconPrefix + "shared.png"}
	}
	encoded, _ := json.Marshal(metadata)
	write(t, root, "docker.json", encoded)
	got, err := NewReader(source, root).Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	missing := 0
	for _, container := range got.Containers {
		total += len(container.IconPNG)
		if len(container.IconPNG) == 0 {
			missing++
		}
	}
	if total > maxSampleBytes || total == 0 || missing == 0 {
		t.Fatalf("unbounded image sample: %d bytes, %d absent", total, missing)
	}
}
