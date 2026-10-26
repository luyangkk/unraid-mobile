# Unraid Mobile

Mobile-first console for a single Unraid server, built with Go and React.

**Current status: read-only system, storage, Docker and VM preview.** The image shows host CPU,
memory, selectable host-interface network rates, uptime and recognized CPU sensors. Metrics
are sampled every second and delivered through REST snapshots and SSE. The CPU
and network trends keep at most 60 points within 60 seconds in browser memory. Initial/invalid rate samples
are unknown, not zero. Storage shows Array/Parity state, per-filesystem capacity,
pools, disk temperature and physical-device I/O from Unraid metadata and procfs.
Docker shows all containers, their actual states, CPU, working-set memory,
uptime and network rates when the Engine socket is mounted. VM preview reads
domain state and assigned CPU/RAM through the libvirt read-only socket. Optional
`APP_TOKEN` authentication protects every API request. VM/Docker control is not
implemented; write capabilities remain disabled.

The mobile shell has four browser History routes: **Home** (`/`), **Docker**
(`/docker`), **VM** (`/vm`) and **Storage** (`/storage`). Home keeps the complete
System panel and CPU/network trends, running Docker/VM overviews and Storage capacity
summaries. The other pages show the full resource lists and diagnostics. Fixed
bottom navigation includes safe-area spacing, keyboard focus and current-page
labels. Unknown client routes offer a return to Home.

CPU details expand inline below CPU/Memory and above Network. The summary keeps
the logical processor count visible; expanded content shows the reported model,
frequency and current per-processor usage on fixed 0–100 measurement bars.
The 10s/30s/60s radio options filter the existing aggregate CPU trend only.
Disclosure/window preferences and samples survive Tab changes in Shell memory;
reload or logout restores closed details and a 60s window. Missing values stay
unknown, retained samples remain marked stale, and incomplete history is labelled
collecting. Opening details or changing the window does not add a request or SSE.

`cpuUsage` and `cpuTemperature` remain compatible. New System REST/SSE fields are
`cpuInfo` (`model`, `reportedFrequencyHz`, `logicalCPUCount`) and
`cpuLogicalProcessors` (`id`, nullable `usage`, optional `reason`).
The logical IDs/count come from the same mounted `/proc/stat` read as aggregate
CPU. Usage excludes guest double-counting and includes iowait in idle; each
logical processor maintains its own adjacent-sample baseline.
Model and frequency use only `model name` and `cpu MHz` from mounted
`/proc/cpuinfo`. Reported frequency is the average of finite positive reports,
converted to Hz; it is neither a fixed clock nor a physical core count.
Optional missing cpuinfo does not invalidate other System telemetry.
CPU automation, browser captures and remaining image/live-host/device acceptance
gaps are recorded in the [CPU validation report](docs/validation/2026-10-26-cpu-details.md).

Swipe left in the page body or bottom navigation to move one Tab forward
(Home → Docker → VM → Storage), or right to move back. The ends do not wrap.
Only single-finger touch gestures participate; controls, horizontal scrollers,
the viewport's outer 24px, headers and open or exiting sheets keep their own
interaction. Vertical scrolling and pinch zoom remain available. A valid bottom
swipe consumes its own click even at a boundary; normal taps still work.
Pending navigation ignores further swipes. Committed Tab changes use a 220ms
opacity entry on one mounted page; reduced motion skips the fade while keeping
Tab swipes. Initial loading and live data updates do not replay it.

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
is unchanged. Business samples, interface selection and trends remain in memory only.

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
- In Android Chrome, iOS Safari and the installed PWA, swipe both directions in
  the body and bottom links. Check one adjacent Tab per swipe, no wrapping or
  accidental link activation at the ends, subsequent taps, vertical scrolling,
  pinch zoom and browser edge-back gestures. Check fades on taps, Home entries
  and browser back/forward; Reduce Motion must retain Tab swipes without fading.
  While a disk sheet is open or exiting, its right swipe must never change Tab.
  Throttle a lazy route chunk: confirm the loading placeholder, ignored repeated
  swipes and working bottom links. Confirm no extra SSE or module polling.
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
returning to the foreground. Home shows Running containers in a two-column
icon/name grid, naturally sorted by name (case insensitive). Names stay on one
line with an ellipsis. The first eight appear by default; “Show N more containers”
expands the grid, and “Show fewer containers” collapses it. Expansion survives
route changes and polling within the current session, resets on page reload,
and is never written to browser storage. Container items have no click action.
The Docker page retains full telemetry, its locally saved Running fold, collapsed
Stopped containers and the separate Other group for transitional states. Failed refreshes retain the last
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
variables or full inspect responses. Home and Docker-page icons use Unraid's existing local PNG cache, verified on
Unraid 7.1.0. Running, Stopped and Other rows share the authenticated image loader;
collapsed Running/Stopped groups defer image requests until expanded. Background
and offline pages pause new image requests and keep already loaded icons.
The existing read-only `/var/local/emhttp` mount covers
`plugins/dynamix.docker.manager/docker.json` and `images/`. The adapter reads only
the per-container `icon` reference and accepts PNG files beneath that fixed image
directory, with a 1 MiB metadata limit, 512 KiB per image, 4096px maximum image
dimensions and an 8 MiB image-read budget per sample. Missing, invalid or
unsupported icons fall back to the bundled generic icon without disabling Docker.
The backend never downloads external image URLs. Container icons need no template
directory or additional host mount. `GET /api/v1/docker` includes an optional `iconVersion` digest;
`GET /api/v1/docker/{id}/icon?v={iconVersion}` serves only the current cached PNG,
requires the same Bearer Header as other API reads, and returns `Cache-Control:
no-store`. The frontend fetches it into a temporary object URL, aborts obsolete
requests and revokes the URL when released. Icons are not cached for offline use.
When FolderView2 is installed, optionally mount
`/boot/config/plugins/folder.view2` at `/host/boot/config/plugins/folder.view2:ro`
(the production template provides an empty optional path field). In Unraid,
set **Host Path** to `/boot/config/plugins/folder.view2`, **Container Path** to
`/host/boot/config/plugins/folder.view2`, and **Access Mode** to `Read Only`.
Pulling a new image does not update path entries in an existing user template;
using the host path as the container path leaves Home ungrouped. After applying
the mapping, `GET /api/v1/docker` should contain `folders` with the expected
members. See the [live mount correction](docs/validation/2026-10-26-folderview2-live/report.md).
The sampler
reads only `docker.json`, limited to 1 MiB and 64 folders; it never executes plugin
scripts or actions. Home merges explicit members, JavaScript regex matches and
containers carrying the matching `folder.view2` label into a single folder item.
A folder appears while any member is running, with the member count available to
assistive technology. Fully stopped folders stay off Home. The eight-item limit
is applied after grouping, while the header still counts actual running
containers. The Docker page keeps its full per-container rows.

Folder PNG data URIs use the authenticated image cache. Configured HTTPS PNG URLs
are fetched directly by the browser with CORS, no app token, no cookies, no
referrer and `no-store`, bounded to 512 KiB; unsupported sources or failures use a
generic folder icon. The backend is not a URL proxy. A remote origin must permit
CORS; HTTP, credential-bearing URLs, non-PNG images and missing configuration
fall back safely. Missing members are ignored, and overlapping membership is
claimed by the first folder in configuration order. Home retains its name sort;
plugin custom ordering, folder actions and scripts are not imported. See
[FolderView2 verification](docs/validation/2026-10-25-folderview2/report.md).

See [source verification and local checks](docs/validation/2026-10-25-home-docker/report.md)
for the tested host version and remaining device/deployment checks.

`capabilities.docker` means Docker data can be read. Separate
`dockerActions.start/stop/restart` flags remain false, so read access does not
enable operations. Mounting a Unix socket read-only does **not** make its API
read-only; this application sends only fixed Engine read requests. Existing
Unraid installations must add the optional socket mount manually after updating
the image. On the authorized Unraid 7.1.0 host, the deployed API and WebGUI
agree on 25 containers (13 running, 12 stopped). One container has unavailable
network counters. This observation does not verify actual container mount or
socket permissions; see the
[host read comparison](docs/validation/2026-10-24-host-read-comparison/report.md).

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
experimental and require manual validation on an authorized host. See the
[host read comparison](docs/validation/2026-10-24-host-read-comparison/report.md).
Existing installations must add the optional
libvirt directory mount manually.

Missing mounts, missing sensors or host-network permission errors are shown as
unavailable data with diagnostics. Each System sample reads all host interface
counters once from `/host/proc/1/net/dev`. **Auto** selects the lowest-metric active
default IPv4 route from `/host/proc/1/net/route` and shows its resolved name.
Choose a sampled interface to view its own Receive (RX) and Transmit (TX);
these are interface rates, not Internet download/upload speed. Only one interface
is displayed, without adding bridges, bonds and their members together.
Selection changes only browser display, persists across Tabs, and resets to Auto
on reload or logout. A removed manual interface stays selected and unavailable.
Without a default route Auto is unavailable, but readable manual interfaces work.

Each interface has its own adjacent-sample baseline and actual elapsed time.
First/new, rollback and recovery samples have null rates; unchanged valid
counters have real zero rates. Local interface errors do not reset other
interfaces or make CPU/memory unavailable. Mounted sysfs ifindex changes are
detected when readable; ifindex reuse and namespace differences mean same-name
replacement detection remains best effort. No additional mounts or host settings
are required.

Receive and Transmit have separate compact SVG trends with a shared zero-based
scale. Network history uses server timestamps, at most 60 samples in the latest
60-second window. Duplicate and older timestamps are ignored; missing values and
gaps over 3 seconds break lines. Interface changes reset network history.
Background/disconnect gaps are not filled, and stale curves keep their sample
time. Each direction needs two valid values to replace “Collecting trend…”.
CPU and network strokes use `chart-line`, mapped to the theme's brand text
(Dark `#FF8C2F`, Light `#F15A2C`); changing theme keeps samples and the stream.
Graph emphasis does not indicate health, and capacity colors remain independent.

The API sends B/s and the UI uses B/s, KiB/s and MiB/s. When comparing with the
native Dashboard, first choose the same interface and observe the same continuous
time window. Convert B/s to decimal Kbps with `rate × 8 / 1000` (or Mbps with
`rate × 8 / 1000000`); for example, 1 MiB/s is 8388.608 Kbps.
Different sampling windows can produce different instantaneous values.
See the [System API contract](docs/http-api.md) and
[network validation record](docs/validation/2026-10-26-network-trends.md).

CPU temperature requires a labelled CPU hwmon sensor or a known
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

After deployment, follow the [manual host acceptance checklist](#manual-host-acceptance).

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

## Manual host acceptance

Use the main application's read-only pages and existing API on an authorized
Unraid host. Deploy with the [Unraid template](deploy/unraid/unraid-mobile.xml)
or the documented unprivileged `docker run` command. The higher-privilege
development Compose configuration is not a production permissions template.

1. Record the image revision, Unraid version, enabled read modules and observation
   time. Check the configured mounts and `Privileged=false` in the Unraid Docker
   settings. Seeing data in the application does not prove read-only mount mode
   or socket permissions.
2. Open Home and Storage and wait for fresh samples. Compare CPU, memory, uptime,
   recognized CPU temperature, Array/Parity state, Pool capacity and disk state
   with the Unraid WebGUI. Compare CPU over matching sampling windows; for network
   rates select the same interface and convert `B/s × 8 / 1000` to Kbps. Rates from
   first or invalid samples are unknown. Missing optional metrics and unconfigured
   resources are recorded separately from collection failures.
   Expand CPU details and compare the processor model and complete numeric logical
   ID set. Observe aggregate and individual usage continuously over matching
   intervals; a single screenshot does not establish rate accuracy.
   Record the mounted cpuinfo frequency reports and their averaging semantics
   separately from WebGUI's displayed MHz, and verify the labelled sysfs CPU
   temperature source rather than substituting the motherboard sensor.
   New CPU fields require a deployed image containing this extension; an older
   response exercises backward compatibility only.
3. Open Docker if its optional socket is mounted. Compare the full Running,
   Stopped and Other lists and counts, not only Home's running overview. Record
   partial statistics and diagnostics without discarding otherwise readable rows.
   Leave VM reads disabled unless explicitly validating that module on an
   authorized host. With `VM_READ_ENABLED=true` and the read-only libvirt directory
   mount, compare VM states and assigned CPU/RAM with WebGUI; unknown uptime,
   unobserved states and daemon recovery remain unverified.
4. Watch sample times advance. A stale or retained snapshot does not establish
   current read availability. Expand diagnostics and record `unavailable`, unknown
   fields, request failures and their reasons. Sleeping disks must show `Temp —`;
   do not run SMART or disk activity to obtain a temperature. Record disk states
   before and after observation; an unexplained power-state change prevents a
   claim that observation did not wake disks.
5. If needed, inspect existing REST snapshots and container logs. In LAN mode,
   use the requests below, substituting the deployed address. `/healthz` returning
   `204` proves only process liveness. A module can return HTTP `200` with
   `available=false`; check its reason, diagnostics and sampling time.

   ```sh
   curl -i http://10.0.0.66:18080/healthz
   curl http://10.0.0.66:18080/api/v1/capabilities
   curl http://10.0.0.66:18080/api/v1/system
   curl http://10.0.0.66:18080/api/v1/storage
   curl http://10.0.0.66:18080/api/v1/docker
   curl http://10.0.0.66:18080/api/v1/vms
   docker logs --tail 50 unraid-mobile
   ```

   Token-enabled API requests require `Authorization: Bearer <APP_TOKEN>`;
   `/healthz` remains public. Use a trusted HTTPS connection when sending the
   token. Keep credentials out of URLs, verbose HTTP traces, saved snapshots and
   shared logs.

Record each module's observed result, unknown fields and remaining scenarios.
Host compatibility is limited to the scenarios actually observed and recorded;
local synthetic tests, process health and readable paths alone do not establish
it. Read acceptance does not
authorize or validate write operations. The
[historical host read comparison](docs/validation/2026-10-24-host-read-comparison/report.md)
contains earlier API/WebGUI observations and their limitations.

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
