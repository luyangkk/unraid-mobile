// Package folderview reads the fixed, optional FolderView2 configuration file.
package folderview

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"io"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
)

const (
	maxConfigBytes = 1 << 20
	maxFolders     = 64
	maxIconBytes   = 512 << 10
)

type Reader struct {
	engine    docker.Reader
	directory string
}

func NewReader(engine docker.Reader, directory string) *Reader {
	return &Reader{engine: engine, directory: directory}
}

type definition struct {
	Name       string   `json:"name"`
	Icon       string   `json:"icon"`
	Containers []string `json:"containers"`
	Regex      string   `json:"regex"`
}

func (r *Reader) Read(ctx context.Context) (docker.Raw, error) {
	raw, err := r.engine.Read(ctx)
	if err != nil {
		return raw, err
	}
	raw.Folders = nil
	root, err := os.OpenRoot(r.directory)
	if err != nil {
		return raw, nil
	}
	defer root.Close()
	info, err := root.Lstat("docker.json")
	if err != nil {
		return raw, nil
	}
	if !info.Mode().IsRegular() || info.Size() > maxConfigBytes {
		return unavailable(raw), nil
	}
	file, err := root.Open("docker.json")
	if err != nil {
		return unavailable(raw), nil
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxConfigBytes {
		return unavailable(raw), nil
	}
	data, err := io.ReadAll(io.LimitReader(file, maxConfigBytes+1))
	if err != nil || len(data) > maxConfigBytes {
		return unavailable(raw), nil
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return unavailable(raw), nil
	}
	// Preserve definition order so overlapping membership never duplicates a row.
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return unavailable(raw), nil
		}
		id, ok := key.(string)
		var def definition
		if !ok || dec.Decode(&def) != nil {
			return unavailable(raw), nil
		}
		if !validID(id) || strings.TrimSpace(def.Name) == "" || len(def.Name) > 256 || len(def.Containers) > 1024 || len(def.Regex) > 1024 {
			continue
		}
		if len(raw.Folders) >= maxFolders {
			return unavailable(raw), nil
		}
		selected := make(map[string]bool, len(def.Containers))
		for _, name := range def.Containers {
			selected[name] = true
		}
		folder := docker.RawFolder{ID: "folder-" + id, Name: def.Name, MatchPattern: def.Regex, ContainerIDs: []string{}}
		for _, container := range raw.Containers {
			if selected[container.Name] || container.FolderName == def.Name {
				folder.ContainerIDs = append(folder.ContainerIDs, container.ID)
			}
		}
		folder.IconURL, folder.IconPNG = icon(def.Icon)
		raw.Folders = append(raw.Folders, folder)
	}
	if _, err = dec.Token(); err != nil {
		return unavailable(raw), nil
	}
	if dec.Decode(new(any)) != io.EOF {
		return unavailable(raw), nil
	}
	return raw, nil
}
func unavailable(raw docker.Raw) docker.Raw {
	raw.Folders = nil
	raw.Diagnostics = append(slices.Clone(raw.Diagnostics), "FolderView2 configuration unavailable; showing individual containers")
	return raw
}
func validID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-' || c == '.') {
			return false
		}
	}
	return true
}
func icon(ref string) (string, []byte) {
	const prefix = "data:image/png;base64,"
	if strings.HasPrefix(ref, prefix) {
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ref, prefix))
		if err != nil || len(data) > maxIconBytes {
			return "", nil
		}
		config, err := png.DecodeConfig(bytes.NewReader(data))
		if err == nil && config.Width > 0 && config.Height > 0 && config.Width <= 4096 && config.Height <= 4096 {
			return "", data
		}
		return "", nil
	}
	if len(ref) > 2048 {
		return "", nil
	}
	u, err := url.Parse(ref)
	if err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Opaque == "" {
		return u.String(), nil
	}
	return "", nil
}
