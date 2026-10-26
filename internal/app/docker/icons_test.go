package docker

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestIconSnapshotLifecycle(t *testing.T) {
	reader := &testReader{raw: Raw{Containers: []RawContainer{{ID: "one", Name: "Plex", IconPNG: []byte("first png")}}}}
	service := NewService(reader, time.Now)
	first := service.Collect(context.Background())
	version := first.Containers[0].IconVersion
	if version == "" {
		t.Fatal("missing version")
	}
	reader.raw.Containers[0].IconPNG[0] = 'X'
	data, ok := service.Icon("one", version)
	if !ok || string(data) != "first png" {
		t.Fatal("raw data mutated cache")
	}
	data[0] = 'Y'
	data, _ = service.Icon("one", version)
	if string(data) != "first png" {
		t.Fatal("caller mutated cache")
	}
	body, _ := json.Marshal(first)
	if strings.Contains(string(body), "first png") || strings.Contains(string(body), "IconPNG") {
		t.Fatal("raw icon bytes leaked into JSON")
	}
	service.Collect(context.Background())
	if _, ok := service.Icon("one", version); ok {
		t.Fatal("old version served")
	}
	currentVersion := service.Latest().Containers[0].IconVersion
	reader.err = errors.New("engine unavailable")
	service.Collect(context.Background())
	if _, ok := service.Icon("one", currentVersion); ok {
		t.Fatal("unavailable icon retained")
	}
	reader.err = nil
	reader.raw.Containers = nil
	service.Collect(context.Background())
	if _, ok := service.Icon("one", version); ok {
		t.Fatal("removed container icon retained")
	}
}

func TestFolderSnapshotAndIconLifecycle(t *testing.T) {
	reader := &testReader{raw: Raw{Containers: []RawContainer{{ID: "one", Name: "Server", State: "running"}}, Folders: []RawFolder{{ID: "folder-photos", Name: "Photos", ContainerIDs: []string{"one"}, MatchPattern: "^photo_", IconURL: "https://example.test/icon.png", IconPNG: []byte("inline PNG")}}}}
	service := NewService(reader, time.Now)
	first := service.Collect(context.Background())
	version := first.Folders[0].IconVersion
	reader.raw.Folders[0].ContainerIDs[0] = "mutated source"
	first.Folders[0].ContainerIDs[0] = "mutated snapshot"
	if service.Latest().Folders[0].ContainerIDs[0] != "one" {
		t.Fatal("folder membership cache was mutated")
	}
	if data, ok := service.Icon("folder-photos", version); !ok || string(data) != "inline PNG" {
		t.Fatal("missing folder PNG")
	}
	body, _ := json.Marshal(service.Latest())
	if strings.Contains(string(body), "inline PNG") || !strings.Contains(string(body), `"folders"`) {
		t.Fatal("unsafe folder JSON")
	}
	reader.raw.Folders = nil
	service.Collect(context.Background())
	if len(service.Latest().Folders) > 0 {
		t.Fatal("removed folder retained")
	}
	if _, ok := service.Icon("folder-photos", version); ok {
		t.Fatal("removed folder icon retained")
	}
}
