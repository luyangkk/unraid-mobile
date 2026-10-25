// Package dockericons reads only Unraid's verified, locally cached PNG icons.
package dockericons

import (
	"bytes"
	"context"
	"encoding/json"
	"image/png"
	"io"
	"os"
	"path"
	"slices"
	"strings"

	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
)

const (
	maxMetadataBytes = 1 << 20
	maxIconBytes     = 512 << 10
	maxSampleBytes   = 8 << 20
	iconPrefix       = "/state/plugins/dynamix.docker.manager/images/"
)

type Reader struct {
	engine    docker.Reader
	directory string
}

// NewReader adds optional icons to background Engine samples, never HTTP reads.
func NewReader(engine docker.Reader, directory string) *Reader {
	return &Reader{engine: engine, directory: directory}
}

func (r *Reader) Read(ctx context.Context) (docker.Raw, error) {
	raw, err := r.engine.Read(ctx)
	if err != nil {
		return raw, err
	}
	raw.Containers = slices.Clone(raw.Containers)
	for i := range raw.Containers {
		raw.Containers[i].IconPNG = nil
	}
	root, err := os.OpenRoot(r.directory)
	if err != nil {
		return raw, nil
	}
	defer root.Close()
	data, err := readRegular(root, "docker.json", maxMetadataBytes)
	if err != nil {
		return raw, nil
	}
	var metadata map[string]struct {
		Icon string `json:"icon"`
	}
	if json.Unmarshal(data, &metadata) != nil {
		return raw, nil
	}
	used := 0
	for i := range raw.Containers {
		if ctx.Err() != nil || used >= maxSampleBytes {
			break
		}
		container := &raw.Containers[i]
		ref := metadata[container.Name].Icon
		if !strings.HasPrefix(ref, iconPrefix) {
			continue
		}
		filename := strings.TrimPrefix(ref, iconPrefix)
		if filename == "" || path.Base(filename) != filename || strings.Contains(filename, "\\") || !strings.HasSuffix(filename, ".png") {
			continue
		}
		limit := min(maxIconBytes, maxSampleBytes-used)
		data, err := readRegular(root, "images/"+filename, limit)
		if err != nil {
			continue
		}
		used += len(data)
		config, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 4096 || config.Height > 4096 {
			continue
		}
		container.IconPNG = data
	}
	return raw, nil
}

// readRegular rejects links, devices and oversized files within the fixed root.
func readRegular(root *os.Root, name string, limit int) ([]byte, error) {
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > int64(limit) {
		return nil, os.ErrInvalid
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > int64(limit) {
		return nil, os.ErrInvalid
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if len(data) > limit {
		return nil, os.ErrInvalid
	}
	return data, err
}
