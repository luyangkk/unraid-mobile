# Unraid Mobile

Mobile-first console for a single Unraid server, built with Go and React.

**Current status: read-only system metrics preview.** The image shows host CPU,
memory, default-route network rates, uptime and recognized CPU sensors. Metrics
are sampled every second and delivered through REST snapshots and SSE. The CPU
trend keeps at most 60 points in browser memory. Initial/invalid rate samples
are unknown, not zero. VM/Docker control, storage providers and authentication
are not implemented yet; write capabilities remain disabled.

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
| Variable (optional) | `SERVER_NAME=Tower` |

Click Apply and open `http://10.0.0.66:18080`. Keep Privileged off; system metrics
do not need Docker/libvirt sockets or the boot drive. Enable Auto-Start on the
Docker page if desired. Keep access on a controlled LAN; authentication is not
implemented. Existing installations must add both read-only paths manually:
updating an image does not update an already saved Unraid container template.

The server name is explicitly configurable because a bind-mounted procfs
hostname can still describe the container's UTS namespace. Without a configured
name or a separately mounted `/host/etc/hostname`, the UI says Unraid.

Missing mounts, missing sensors or host-network permission errors are shown as
unavailable data with diagnostics. Network rates use the lowest-metric active
default IPv4 route from `/host/proc/1/net/route` and that interface's counters in
`/host/proc/1/net/dev`, avoiding container namespaces and double counting of
bridges, bonds and their member interfaces. No IPv4 default route means no
network rate. CPU temperature requires a labelled CPU hwmon sensor or a known
CPU thermal-zone type. Target-host verification remains necessary.

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
  -e SERVER_NAME=Tower \
  ghcr.io/luyangkk/unraid-mobile:latest
```

Validate with `curl -i http://10.0.0.66:18080/healthz` (expected 204) and
`docker logs --tail 50 unraid-mobile`.

## Publishing and updating

Pushing to `main` or manually running the workflow on `main` runs Go tests,
frontend tests/build, builds the Linux amd64 image, and starts a temporary
unprivileged container to verify health, the embedded UI, its JS asset, missing
mount handling and SSE against synthetic host fixtures. Only
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
