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
domain state and assigned CPU/RAM through the libvirt read-only socket. VM/Docker control and authentication are not implemented; write capabilities
remain disabled.

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
| Variable (optional) | `SERVER_NAME=Tower` |

Click Apply and open `http://10.0.0.66:18080`. Keep Privileged off; system metrics
do not need Docker/libvirt sockets or the boot drive. Docker display needs only
the optional Docker Engine socket, with Privileged still off. Enable Auto-Start on the
Docker page if desired. Keep access on a controlled LAN; authentication is not
implemented. Existing installations must add the read-only paths manually:
updating an image does not update an already saved Unraid container template.

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
the image. Real host compatibility and metric comparisons still need to be
verified on the target Unraid system.

VM preview is disabled by default because real-host compatibility is unverified.
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
implemented. This preview has synthetic protocol/unit coverage, but has not
been validated against a real Unraid libvirt daemon. Validate the socket,
permissions, domain list, state and assigned resources on the target host
before treating it as supported. Existing installations must add the optional
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
`curl http://10.0.0.66:18080/api/v1/docker` (check `available` and diagnostics), and
`docker logs --tail 50 unraid-mobile`.

## Publishing and updating

Pushing to `main` or manually running the workflow on `main` runs Go tests,
frontend tests/build, builds the Linux amd64 image, and starts a temporary
unprivileged container to verify health, the embedded UI, its JS asset, missing
mount handling, SSE and storage against synthetic host fixtures. Only
then is that same image pushed to GHCR with `latest` and `sha-<full-commit-sha>`
tags. Pull requests run the checks without publishing. Publishing uses the
automatic `GITHUB_TOKEN`; no personal access token is needed.

After a successful publish, check for updates on Unraid's Docker page and update
the container. To roll back, edit Repository to an earlier published
`ghcr.io/luyangkk/unraid-mobile:sha-<full-commit-sha>` tag and apply.

## Host capability spike

The separate `host-spike` binary reports path existence via `os.Stat` plus a
`system` snapshot from two real parsing samples one second apart. It does not
connect to Docker/libvirt sockets or perform write operations. `allAvailable`
still describes path existence only; inspect `system.available` and
`system.diagnostics` separately. It exits 2 when a required path is absent or the
system snapshot is unavailable. Run only on the authorized Unraid test host.

`sh scripts/run-host-spike.sh` builds locally on Unraid. To use a prebuilt image:

```sh
docker run --rm --privileged \
  --mount type=bind,src=/proc,dst=/host/proc,readonly \
  --mount type=bind,src=/sys,dst=/host/sys,readonly \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly \
  --mount type=bind,src=/var/run/libvirt,dst=/var/run/libvirt,readonly \
  --mount type=bind,src=/var/local/emhttp,dst=/host/var/local/emhttp,readonly \
  --entrypoint /app/host-spike \
  ghcr.io/luyangkk/unraid-mobile:latest
```

The binary does not issue socket requests. A read-only socket mount alone does
not restrict which API calls a different program could send through it.

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
