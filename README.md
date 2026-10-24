# Unraid Mobile

Mobile-first console for a single Unraid server, built with Go and React.

**Current status: development preview.** The image serves the frontend shell,
health endpoint and capability API. Live host metrics, VM/Docker control,
Array/Parity providers and authentication are not implemented yet. Installing
this image does not enable those features. The header's current Online label is
placeholder UI, not a host health assessment.

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

Click Apply and open `http://10.0.0.66:18080`. No host mounts are required for
this preview. Enable Auto-Start on the Docker page if desired. Keep access on a
controlled LAN; authentication is not implemented.

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
  ghcr.io/luyangkk/unraid-mobile:latest
```

Validate with `curl -i http://10.0.0.66:18080/healthz` (expected 204) and
`docker logs --tail 50 unraid-mobile`.

## Publishing and updating

Pushing to `main` or manually running the workflow on `main` runs Go tests,
frontend tests/build, builds the Linux amd64 image, and starts a temporary
unprivileged container to verify health, the embedded UI and its JS asset. Only
then is that same image pushed to GHCR with `latest` and `sha-<full-commit-sha>`
tags. Pull requests run the checks without publishing. Publishing uses the
automatic `GITHUB_TOKEN`; no personal access token is needed.

After a successful publish, check for updates on Unraid's Docker page and update
the container. To roll back, edit Repository to an earlier published
`ghcr.io/luyangkk/unraid-mobile:sha-<full-commit-sha>` tag and apply.

## Host capability spike

The separate `host-spike` binary checks only path existence via `os.Stat`.
It does **not** validate file parsing, socket connections, sensor mappings or
write operations, even when `allAvailable` is true. It can exit 2 when a required
path is absent. Run it only on the authorized Unraid test host.

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
