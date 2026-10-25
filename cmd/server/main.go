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
	vmadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/libvirt"
	systemadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/system"
	"github.com/unraid-mobile/unraid-mobile/internal/adapter/unraid/dockericons"
	storageadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/unraid/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/api"
	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
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
	dockerMetrics := docker.NewService(dockericons.NewReader(dockeradapter.NewReader("/var/run/docker.sock"),
		"/host/var/local/emhttp/plugins/dynamix.docker.manager"), time.Now)
	go func() {
		dockerMetrics.Collect(ctx)
		dockerMetrics.Run(ctx)
	}()
	// Write capabilities stay unavailable until verified on the target host.
	vmMetrics := vm.NewService(vmReaderFromEnvironment(), time.Now)
	go func() {
		vmMetrics.Collect(ctx)
		vmMetrics.Run(ctx)
	}()
	operations := operation.NewStore(time.Now)
	go operations.Run(ctx)
	apiConfig := apiConfigFromEnvironment()
	apiConfig.VM = vmMetrics
	apiConfig.Docker = dockerMetrics
	apiConfig.System = metrics
	apiConfig.Storage = storageMetrics
	apiConfig.Capabilities = capability.Set{}
	apiConfig.Operations = operations
	apiHandler := api.NewServer(apiConfig)

	staticFiles, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatalf("load embedded web assets: %v", err)
	}

	server := &http.Server{
		Addr:              address,
		Handler:           newFrontendHandler(apiHandler, staticFiles),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	logAuthenticationMode(apiConfig.AppToken)
	log.Printf("Unraid Mobile listening on %s", address)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// apiConfigFromEnvironment preserves the optional credential exactly as configured.
func apiConfigFromEnvironment() api.Config {
	return api.Config{AppToken: os.Getenv("APP_TOKEN")}
}

// logAuthenticationMode reports only the mode, never credentials or their digest.
func logAuthenticationMode(token string) {
	if token == "" {
		log.Print("Unraid Mobile LAN mode (authentication disabled)")
		return
	}
	log.Print("Unraid Mobile authentication enabled")
}

// routeAPIRequests preserves original API paths for validation before the
// static mux can redirect repeated separators or dot segments.
func routeAPIRequests(apiHandler, fallback http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if api.IsAPIRequest(r) {
			apiHandler.ServeHTTP(w, r)
			return
		}
		fallback.ServeHTTP(w, r)
	})
}

// VM reads remain opt-in until target-host compatibility has been verified.
func vmReaderFromEnvironment() vm.Reader {
	if os.Getenv("VM_READ_ENABLED") != "true" {
		return nil
	}
	return vmadapter.NewReader()
}
