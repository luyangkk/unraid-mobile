#!/bin/sh
# Run only against a local Docker daemon / CI runner. No host mounts are used.
set -eu

image_name="${1:?Usage: sh scripts/verify-image.sh IMAGE}"
container_name="unraid-mobile-smoke-$$"

cleanup() {
  docker logs "$container_name" || true
  docker rm -f "$container_name" >/dev/null || true
}

docker run -d --name "$container_name" -p 127.0.0.1::8080 "$image_name" >/dev/null
trap cleanup EXIT
host_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}' "$container_name")"
base_url="http://127.0.0.1:$host_port"

attempt=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$base_url/healthz" || true)" = 204 ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo 'Container did not become healthy' >&2
    exit 1
  fi
  sleep 1
done

home_page="$(curl -fsS "$base_url/")"
asset_path="$(printf '%s' "$home_page" | sed -nE 's/.*src="([^"]+\.js)".*/\1/p')"
case "$asset_path" in
  /assets/*.js) ;;
  *) echo 'Embedded Vite entry asset is missing' >&2; exit 1 ;;
esac
curl -fsS "$base_url$asset_path" -o /dev/null
curl -fsS "$base_url/api/v1/capabilities" | grep -q '"docker":false'
echo 'Image smoke checks passed: health, frontend, asset, capabilities'
