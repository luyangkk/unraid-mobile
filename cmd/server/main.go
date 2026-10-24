package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	dockeradapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/docker"
	systemadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/system"
	storageadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/unraid/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/api"
	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

// web contains the Vite build output. Docker replaces this development
// placeholder with web/dist before compiling the final Go binary.
//
//go:embed web/*
var webFiles embed.FS

// main starts read-only samplers and serves API and embedded frontend assets.
func main() {
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = ":8080"
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	reader := systemadapter.NewReader(os.DirFS("/host"))
	reader.Hostname = os.Getenv("SERVER_NAME")
	metrics := system.NewService(reader, time.Now)
	metrics.Collect(ctx)
	go metrics.Run(ctx)
	storageMetrics := storage.NewService(storageadapter.NewReader(os.DirFS("/host")), time.Now)
	storageMetrics.Collect(ctx)
	go storageMetrics.Run(ctx)
	dockerMetrics := docker.NewService(dockeradapter.NewReader("/var/run/docker.sock"), time.Now)
	go func() {
		dockerMetrics.Collect(ctx)
		dockerMetrics.Run(ctx)
	}()
	// Write capabilities stay unavailable until verified on the target host.
	apiHandler := api.NewServer(api.Config{
		Docker:       dockerMetrics,
		System:       metrics,
		Storage:      storageMetrics,
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
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Unraid Mobile listening on %s", address)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
