package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/api"
	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
)

// web contains the Vite build output. Docker replaces this development
// placeholder with web/dist before compiling the final Go binary.
//
//go:embed web/*
var webFiles embed.FS

func main() {
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = ":8080"
	}

	// Host adapters are introduced only after the Host Capability Spike. Until
	// then every write capability stays unavailable by default.
	apiHandler := api.NewServer(api.Config{
		Capabilities: capability.Set{},
		Operations:   operation.NewStore(time.Now),
	})

	staticFiles, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatalf("load embedded web assets: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", apiHandler)
	mux.Handle("/healthz", apiHandler)
	mux.Handle("/", http.FileServer(http.FS(staticFiles)))

	server := &http.Server{
		Addr:              address,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("Unraid Mobile listening on %s", address)
	log.Fatal(server.ListenAndServe())
}
