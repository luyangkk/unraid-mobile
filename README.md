# Unraid Mobile

Mobile-first console for a single Unraid server, built with Go and React.

**Current status: read-only system, storage, Docker and VM preview.** The image shows host CPU,
memory, default-route network rates, uptime and recognized CPU sensors. Metrics
are sampled every second and delivered through REST snapshots and SSE. The CPU
trend keeps at most 60 points in browser memory. Initial/invalid rate samples
are unknown, not zero. Storage shows Array/Parity state, per-filesystem capacity,
pools, disk temperature and physical-device I/O from Unraid metadata and procfs.
Docker shows all containers, their actual states, CPU, working-set memory,
uptime and network rates when the Engine socket is mounted. VM preview reads
domain state and assigned CPU/RAM through the libvirt read-only socket. Optional
`APP_TOKEN` authentication protects every API request. VM/Docker control is not
implemented; write capabilities remain disabled.

The mobile shell has four browser History routes: **Home** (`/`), **Docker**
(`/docker`), **VM** (`/vm`) and **Storage** (`/storage`). Home keeps the complete
System panel and CPU trend, running Docker/VM overviews and Storage capacity
summaries. The other pages show the full resource lists and diagnostics. Fixed
bottom navigation includes safe-area spacing, keyboard focus and current-page
labels. Unknown client routes offer a return to Home.

One shared QueryClient and one shell-owned System SSE subscription survive page
changes. Docker and Storage poll every two seconds, VM every three seconds;
only the visible page's consumers poll. Home uses all three. Background pages
pause and refresh snapshots on return. Cached samples remain visible with stale
styling and sampling time during offline, paused, failed and pending recovery
states. Business data stays in memory.

On Storage, expand **Disks** and select a disk row to open its read-only details
in AppSheet. Details include capacity, filesystem, current I/O, reported device
and sample time. The open sheet follows the latest Storage snapshot without
another request. Stale samples keep their warning; removed disks stop showing
old details. Standby disks always show `Temp —`.

Close with the button, backdrop, Escape, a downward handle drag or a right swipe
inside the panel. Right swipes must be predominantly horizontal; short slow, leftward,
vertical and canceled gestures keep the panel open. Swipes starting on controls
are ignored. Short handle drags spring back. The modal contains keyboard focus,
restores the selected row on close, locks background scrolling and scrolls long
details independently. Reduced motion disables gesture dismissal and sliding
animations. Home has no disk rows.

The Go server serves the embedded frontend for valid extensionless GET/HEAD
client routes, including direct visits and refreshes. Missing assets return
real `404` responses; `/api` requests and `/healthz` retain their existing
handlers. Static routes remain public when `APP_TOKEN` is enabled.

## Installable PWA and offline shell

The production build supports installation and an offline **static shell**.
After a successful online visit and completed Service Worker installation,
the shell and all route chunks can open without the server. This is not offline
monitoring: API responses, metrics, resource snapshots, Operation results,
health checks and SSE are never cached by the worker. Credentials are never
stored in Cache Storage; the existing per-tab `sessionStorage` token behavior
is unchanged. Business samples and the CPU trend remain in memory only.

An offline cold start shows the shell and a connection error, not restored
business data or a token prompt caused solely by a network failure. An existing
tab can retain its last in-memory samples with stale styling and sample times.
On recovery, capabilities must succeed before protected requests resume, and
System fetches a fresh snapshot before opening one SSE connection.

Installation and Service Workers require a **secure context**: HTTPS with a
certificate trusted by the device, or localhost for local testing. A URL such
as `http://10.0.0.66:18080` still works as the online web console, but a LAN IP
over HTTP does not enable the offline PWA. A home-screen shortcut alone does
not prove that a Service Worker is installed. Localhost on a phone refers to
that phone, not the Unraid server.

Use HTTPS, Tailscale HTTPS (for example, Tailscale Serve), or a trusted HTTPS
reverse proxy in front of the Go server. Tailscale or WireGuard access to an
HTTP LAN URL alone does not make it a secure context. Keep API traffic
uncached, preserve the Authorization header, and disable proxy buffering for
SSE. The Go server itself does not terminate TLS. `APP_TOKEN` controls API
access; it is **not a replacement for HTTPS** and cannot encrypt credentials.

Application icons use the user-selected
[HD-Icons Unraid artwork](https://raw.githubusercontent.com/xushier/HD-Icons/main/border-radius/unraid-2.png),
bundled locally. The original PNG is in `web/icon-source/unraid-2.png`; regenerate
all five icons with `python3 web/scripts/generate-pwa-icons.py` (ImageMagick
`magick` required). Maskable artwork fits inside the safe circle on an opaque
Slate background. Installation and rendering never fetch the remote image.

The manifest `/manifest.webmanifest`, worker `/sw.js`, and `/icons/*.png` remain
public in LAN and token-enabled modes. The server sends
`application/manifest+json` for the manifest, a JavaScript MIME type for the
worker, and `Cache-Control: no-cache` for `/sw.js` so browsers revalidate it.
Only canonical same-origin static resources and eligible browser navigations
can use the worker's static cache; missing assets never become cached HTML.
Activation deletes old cache names after carrying their built JS/CSS into the
current static cache, so a tab that has not refreshed can still load its old
route chunks offline. A cache created by a later installation is left alone.
If migration hits a storage limit, its source remains available for old static
chunks and cleanup can retry on a later activation. Business responses are
never carried between caches.

A newly downloaded version offers an update banner. Select **Refresh** to
activate it and reload this tab once. Dismissing the banner keeps the current
version; another tab accepting an update does not force this tab to reload.
Registration failures or unsupported browsers do not block the online console.
Development mode does not register a worker by default; use a production build
to check installation, offline behavior and updates.

### Manual Android and iOS checklist

These checks have **not been performed on real Android or iOS devices**.
Automated server, build and worker tests do not establish device compatibility.

- On Android Chrome, open the trusted HTTPS URL, finish the first online load,
  install from the browser's install menu, and launch the home-screen app.
- On iOS Safari, open the same HTTPS URL, use Share > Add to Home Screen, and
  launch from the home screen. Confirm standalone launch and the intended icon.
- Check Home, Docker, VM and Storage in portrait and landscape. Verify top and
  bottom safe areas, notches, the home indicator, bottom navigation and token
  input with the keyboard open; no controls should be clipped.
- On Storage, open both an active and a standby disk. Check detail scrolling,
  bottom safe-area spacing, close button, backdrop, handle dragging and snap-back.
  Enable the device's Reduce Motion setting: dragging and slide animations should
  stop, while button and keyboard dismissal remain usable. With a hardware
  keyboard, check Tab containment and return focus. Observe existing temperatures
  only; do not wake a standby disk to validate the display.
- After installation completes, go offline before visiting the other routes.
  Reopen the installed app and test cold starts and deep links. The shell and
  connection screen should load without restoring metrics or business snapshots.
- Disconnect an already running session. Check stale labels and sample times;
  reconnect and verify capabilities succeeds before resource refreshes. A
  transport failure must not erase the saved token or masquerade as a `401`.
- With remote browser inspection, check that API, health and SSE responses and
  credentials never appear in Cache Storage. Confirm a fresh System snapshot
  precedes SSE and at most one active SSE remains after route changes,
  background/foreground transitions and reconnection.
- Publish a newer test build. Dismiss its update banner and confirm no reload;
  then accept Refresh and confirm exactly one reload. Repeat with a second tab
  accepting first to check that an unconfirmed tab is not reloaded.
- Repeat the online/offline/recovery checks in LAN mode and with `APP_TOKEN`.
  Also check an HTTP LAN IP: the online console should work without promising
  Service Worker installation or offline support.

## Install the prebuilt image on Unraid

Image: `ghcr.io/luyangkk/unraid-mobile:latest` (`linux/amd64`, including Intel N100).
The first successful [publishing workflow](https://github.com/luyangkk/unraid-mobile/actions)
must finish before this image exists.

For anonymous pulls, the owner must open the
[package settings](https://github.com/users/luyangkk/packages/container/unraid-mobile/settings)
after the first publish and change package visibility to Public. The source
repository can remain private. A public image makes its bundled files publicly
downloadable; do not include secrets in the image.

In Unraid **Docker → Add Container**, use:

| Field | Value |
|---|---|
| Name | `unraid-mobile` |
| Repository | `ghcr.io/luyangkk/unraid-mobile:latest` |
| Network type | Bridge |
| Privileged | Off |
| Host port | `18080` (or another unused port) |
| Container port | `8080` / TCP |
| WebUI (Advanced View) | `http://[IP]:[PORT:8080]/` |
| Path (read-only) | `/proc` on host → `/host/proc` in container |
| Path (read-only) | `/sys` on host → `/host/sys` in container |
| Path (read-only) | `/var/local/emhttp` on host → `/host/var/local/emhttp` in container |
| Path (optional, read-only) | `/var/run/docker.sock` on host → `/var/run/docker.sock` in container |
| Path (optional, read-only) | `/var/run/libvirt` on host → `/var/run/libvirt` in container (requires `libvirt-sock-ro`) |
| Variable (optional) | `VM_READ_ENABLED=false` (default; enable only for target-host validation) |
| Variable (optional, masked) | `APP_TOKEN` (empty by default; enables Bearer authentication when nonempty) |
| Variable (optional) | `SERVER_NAME=Tower` |

Click Apply and open `http://10.0.0.66:18080`. Keep Privileged off; system metrics
do not need Docker/libvirt sockets or the boot drive. Docker display needs only
the optional Docker Engine socket, with Privileged still off. Enable Auto-Start on the
Docker page if desired. Keep access on a controlled LAN. Existing installations
must add the read-only paths and optional variables manually:
updating an image does not update an already saved Unraid container template.

### Optional API authentication

Leave `APP_TOKEN` unset or empty for the existing LAN mode. Any nonempty value
enables authentication, including whitespace-only values; credentials are never
trimmed. Generate a strong random credential using Bearer-compatible characters
(for example, a random hexadecimal string), not a repository example or a reused
password. Add `APP_TOKEN` as an optional masked Variable in Unraid and apply the
container configuration. Existing containers need this variable added manually,
even after downloading a newer template or image.

Authenticated clients must send `Authorization: Bearer <credential>` on every
`/api` request, including REST, Operation queries and SSE. Send exactly one
credential, never a cookie or URL/query token. Missing, malformed and incorrect
credentials all return the same nonretryable `401 UNAUTHORIZED` with
`Authentication required`, `WWW-Authenticate: Bearer` and `Cache-Control: no-store`.
The health endpoint `/healthz`, page and static assets remain public. Enabling
authentication does not enable any write capability.

The page checks capabilities before starting any business requests. When
authentication is required, enter APP_TOKEN in the password field and select
Connect. Only a successfully validated credential is saved in this tab's
`sessionStorage` under `unraid-mobile.app-token`; refreshing keeps the session.
REST, polling and fetch-based SSE share the same Bearer header. Credentials
never enter URLs, query keys or persistent business caches.

Use the Clear token button to end the session. Any API or SSE `401` also clears
the token, cancels requests, closes the stream and removes protected query data
before showing the input form again. Closing the tab ends the stored session.

The server does **not** provide TLS: Bearer authentication over HTTP does not
encrypt credentials or metrics. Do not expose the HTTP port directly to the
internet. Outside a controlled LAN, use HTTPS, Tailscale or WireGuard. The
installable offline PWA still requires HTTPS or localhost, even over a VPN;
`APP_TOKEN` is not a replacement for HTTPS.
Template masking only hides the form value;
the container environment is still accessible to administrators. Never publish
it in logs, screenshots or diagnostics. Startup logs report only LAN mode or
authentication enabled.

The server name is explicitly configurable because a bind-mounted procfs
hostname can still describe the container's UTS namespace. Without a configured
name or a separately mounted `/host/etc/hostname`, the UI says Unraid.

Docker data is sampled in the backend every two seconds and served from
`GET /api/v1/docker`. The page polls the cache while visible and refreshes after
returning to the foreground. All Running containers are shown; their collapse
preference is saved locally. Stopped containers start collapsed, and paused or
transitional states appear under Other. Failed refreshes retain the last
snapshots and sampling time; missing socket access is shown as unavailable.

CPU and network rates use adjacent valid Engine counters. First samples,
restarts, counter resets and telemetry recovery report unknown rates rather
than zero. Memory is the Engine usage minus reported inactive-file cache
(with the cgroup v1 cache fallback). A container's missing stats or inspect
response leaves its list entry visible with unknown affected metrics and
diagnostics. Startup identity is checked around stats to avoid mixing counters
across a restart. Sampling is bounded to four workers, two seconds per request
and eight seconds per round; deferred containers get priority next round.
The reader negotiates the daemon's supported range within API 1.24–1.44.
Only selected display fields are exported, never environment
variables or full inspect responses. Icons use a generic local container icon
until an Unraid metadata source is verified.

`capabilities.docker` means Docker data can be read. Separate
`dockerActions.start/stop/restart` flags remain false, so read access does not
enable operations. Mounting a Unix socket read-only does **not** make its API
read-only; this application sends only fixed Engine read requests. Existing
Unraid installations must add the optional socket mount manually after updating
the image. On the authorized Unraid 7.1.0 host, the deployed API and WebGUI
agree on 25 containers (13 running, 12 stopped). One container has unavailable
network counters. This observation does not verify the updated standalone
Spike or actual container mount permissions; see the
[host validation record](docs/validation/2026-10-24-host-spike/report.md).

VM preview remains disabled by default pending complete host compatibility validation.
For an authorized validation host, set `VM_READ_ENABLED=true` explicitly and add
the optional libvirt directory mount. Other values leave collection disabled;
no libvirt connection is attempted. This setting enables reads only.

When enabled, VM snapshots are sampled every three seconds and served from
`GET /api/v1/vms`. The page polls while visible, refreshes on returning to the
foreground, cancels abandoned requests and retains the last sample on request
failure. Cards show Running, collapsed Stopped (shut off), and Other states such
as paused, shutting down, crashed or suspended. Assigned vCPUs and RAM come from
selected live domain XML fields (`vcpu` current count and `currentMemory`, with
`memory` as fallback), not runtime CPU or memory usage. XML and private device
paths never leave the adapter. Missing per-domain details keep the VM visible
with unknown fields and diagnostics.

The pure Go libvirt client connects only to
`/var/run/libvirt/libvirt-sock-ro` with the fixed `qemu:///system` URI. There is
no fallback to the writable socket, shell commands or network endpoints. Mount
`/var/run/libvirt` read-only rather than an individual socket so daemon socket
recreation can recover on the next sample. If the host does not expose a
read-only socket or permissions deny access, the VM panel remains unavailable.
A read-only directory mount alone does not restrict socket API permissions;
the application uses only the read-only endpoint and fixed read calls. Each
sample has a six-second deadline and a 1,024-domain limit.

Uptime is currently `null`: the queried libvirt APIs do not expose a reliable
boot timestamp, and accumulated vCPU time must not be presented as elapsed
uptime. `capabilities.vm` expresses successful reads only;
`vmActions.start/stop/forceStop` remain false and VM action routes are not
implemented. On the authorized Unraid 7.1.0 host, one running VM's list entry,
state, 4 assigned vCPUs and 1 GiB assigned RAM agree with the WebGUI.
Stopped/paused/crashed domains, socket permissions and daemon recovery remain
experimental; the updated standalone Spike still requires execution on that
host. See the [Spike validation record](docs/validation/2026-10-24-host-spike/report.md).
Existing installations must add the optional
libvirt directory mount manually.

Missing mounts, missing sensors or host-network permission errors are shown as
unavailable data with diagnostics. Network rates use the lowest-metric active
default IPv4 route from `/host/proc/1/net/route` and that interface's counters in
`/host/proc/1/net/dev`, avoiding container namespaces and double counting of
bridges, bonds and their member interfaces. No IPv4 default route means no
network rate. CPU temperature requires a labelled CPU hwmon sensor or a known
CPU thermal-zone type. Target-host verification remains necessary.

Storage uses only `disks.ini` and `var.ini` in the mounted Unraid state directory;
it does not scan user files, run SMART commands or mount `/mnt`. Capacity fields
are converted from KiB to bytes. Array capacity sums only assigned Data disks
whose filesystems are mounted; Parity, Flash and pool disks are excluded. A pool
uses its canonical first member once, never the sum of mirrored members. For
Btrfs, effective capacity follows Unraid's display convention: used plus free.
Stopped arrays and incomplete/invalid capacity metadata are shown as unknown.
Pools, temperatures, disk power state and parity progress reflect reported
metadata, not inferred health. A spun-down disk reports no live temperature by
design, so the UI shows `Standby` and does not wake it for a SMART reading.
Host diskstats sector counters use 512-byte units; rates reset after
errors, counter resets or disk replacement. Storage snapshots refresh every two
seconds while the page is visible. Missing metadata shows the exact required
mount. Only whitelisted fields are returned; no serial IDs or CSRF tokens are
exported. Reference formats: [Unraid state sample](https://github.com/unraid/api/blob/main/api/dev/states/disks.ini)
and [WebGUI device rendering](https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix/nchan/device_list).

A matching user template is provided at
[`deploy/unraid/unraid-mobile.xml`](deploy/unraid/unraid-mobile.xml).
To use that file instead of filling the form, download it while signed in to
GitHub, copy it to
`/boot/config/plugins/dockerMan/templates-user/my-unraid-mobile.xml` on Unraid,
then select it in Docker → Add Container. Do not use an anonymous raw-file URL
while the source repository is private. Manually adding the container also saves
a reusable user template, so copying the XML is optional.

For a CLI installation after publishing:

```sh
docker run -d --name unraid-mobile \
  --restart unless-stopped \
  -p 10.0.0.66:18080:8080 \
  --mount type=bind,src=/proc,dst=/host/proc,readonly \
  --mount type=bind,src=/sys,dst=/host/sys,readonly \
  --mount type=bind,src=/var/local/emhttp,dst=/host/var/local/emhttp,readonly \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly \
  -e SERVER_NAME=Tower \
  ghcr.io/luyangkk/unraid-mobile:latest
```

Omit the optional Docker socket mount if Docker display is not needed. For VM
preview, add `--mount type=bind,src=/var/run/libvirt,dst=/var/run/libvirt,readonly`
only when the host exposes `libvirt-sock-ro`, together with `-e VM_READ_ENABLED=true`
for target-host validation.

Validate with `curl -i http://10.0.0.66:18080/healthz` (expected 204),
`curl http://10.0.0.66:18080/api/v1/docker` in LAN mode (check `available` and diagnostics), and
`docker logs --tail 50 unraid-mobile`.
When `APP_TOKEN` is enabled, API checks require the Bearer header; `/healthz`
still returns 204 without it. Avoid verbose HTTP traces that disclose the header.

## Operation infrastructure

`GET /api/v1/operations/{operationId}` returns a complete in-memory Operation.
Unknown or expired IDs return `404 OPERATION_NOT_FOUND`; a missing Store returns
`503 OPERATIONS_UNAVAILABLE`. Malformed paths return `404 ROUTE_NOT_FOUND`.
Unknown progress is explicitly `null`. Running operations may report finite
progress from 0 to 100, and failed results may include a structured error.

`GET /api/v1/events` retains `system.metrics` and additionally publishes
`operation.updated` after creation, lifecycle transitions and progress changes.
Every event contains a full snapshot. Each source has an independent
capacity-one subscription; slow clients retain only the latest update.
Disconnects and write failures release both subscriptions. The existing
15-second comment heartbeat, no-cache/no-buffer headers and write deadlines
remain in place. Operations have no historical event replay: clients query
their known IDs after reconnecting.

Only one pending/running operation can reserve a resource. Terminal results
immediately release it and cannot transition again. At most 100 terminal
records are retained, each for at most 24 hours from completion; the oldest
endedAt is evicted first. Active operations are exempt from eviction. Queries
and changes prune expired records, and a context-owned timer cleans up idle
records. The Store does not persist or restore operations after restart;
clients recover actual resource state from fresh resource snapshots.

This infrastructure has no executor and performs no host writes. Production
Docker start/stop/restart capabilities remain false and POST requests are
rejected. Tests explicitly enable fake capabilities to create pending records;
those records never execute automatically. No operation list, client
mutation/cancellation endpoints or UI controls are provided.

## Publishing and updating

Pushing to `main` or manually running the workflow on `main` runs Go tests,
frontend tests/build, builds the Linux amd64 image, and starts a temporary
unprivileged container to verify health, the embedded UI, its JS asset, PWA
manifest fields and MIME types, all icons, the worker's revalidation header,
deep links, asset `404` responses, missing mount handling, SSE and storage
against synthetic host fixtures. It also verifies
LAN mode and token-enabled API rejection/success using a disposable random
credential generated at runtime, with public health and assets in both modes. Only
then is that same image pushed to GHCR with `latest` and `sha-<full-commit-sha>`
tags. Pull requests run the checks without publishing. Publishing uses the
automatic `GITHUB_TOKEN`; no personal access token is needed.

After a successful publish, check for updates on Unraid's Docker page and update
the container. To roll back, edit Repository to an earlier published
`ghcr.io/luyangkk/unraid-mobile:sha-<full-commit-sha>` tag and apply.

## Host capability spike

The separate `host-spike` binary reuses the production adapters and services to
sample System and Storage, including Array/Parity metadata, twice. Docker and
VM protocol probes run only when `SPIKE_DOCKER_READ_ENABLED=true` and
`SPIKE_VM_READ_ENABLED=true` respectively. Other values report `skipped` and
do not access optional sockets. VM always uses `libvirt-sock-ro`; Docker uses
only the existing version, list, inspect and non-streaming stats GET requests.

Each module has its own result, status and sanitized diagnostics. The versioned
JSON includes UTC time, surface checks, intended mounts, observed mount modes
when `/proc/self/mountinfo` provides evidence, permissions and unverified
capabilities. A successful path check alone does not establish read-only mount
mode or container privilege settings. Docker output contains counts and status
summaries; VM adds counts of available assigned CPU/RAM fields. No names,
identifiers, serials, XML, full inspect, labels or environment are exported.
`writeVerified` is always false. Read compatibility does not validate Array or
Parity control entry points or authorize production executors.

Exit codes: `0` means required checks and enabled optional protocols passed;
`1` means an internal/report encoding error; `2` means a required or enabled
probe failed or was incomplete. Optional metrics may remain unknown with
diagnostics. Whole-run and module deadlines prevent sockets from waiting
indefinitely. No probe runs host commands, scans `/mnt`, performs SMART or
mutates a host resource.

Run only on the explicitly authorized Unraid test host. The launcher builds
locally unless `SPIKE_IMAGE` names a prebuilt image containing the updated
binary. Builds go to stderr, leaving stdout for JSON. It uses no privileged
mode or `/boot` mount. Missing optional sockets are left unmounted so the
binary can report their failure while retaining other module results:

```sh
SPIKE_DOCKER_READ_ENABLED=true SPIKE_VM_READ_ENABLED=true \
  sh scripts/run-host-spike.sh
```

To retain raw JSON without writing host files, redirect the authorized remote
execution's stdout to a local validation directory. Retain its exit code
separately. Do not assume an already deployed image includes an unshipped Spike
change. `docker compose --profile spike run --rm host-spike` performs only the
default System/Storage probes; use the launcher for conditional socket mounts.
A read-only socket mount alone does not restrict socket API methods.

## Local development

```sh
go test ./...
go run ./cmd/server
```

```sh
cd web
npm ci
npm test
npm run build
npm run dev
```

The local Go entrypoint embeds a placeholder page. The Docker build replaces it
with Vite output, so use Docker to verify the complete packaged frontend:

```sh
docker build -t unraid-mobile:local .
sh scripts/verify-image.sh unraid-mobile:local
```

Product scope and contracts:
[`docs/spec-20260921-mvp.md`](docs/spec-20260921-mvp.md) and
[`docs/plan-20260921-mvp.md`](docs/plan-20260921-mvp.md).
