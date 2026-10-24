#!/bin/sh
# Run only against a local Docker daemon / CI runner. No host mounts are used.
set -eu

image_name="${1:?Usage: sh scripts/verify-image.sh IMAGE}"
container_name="unraid-mobile-smoke-$$"
fixture_container="$container_name-fixture"

cleanup() {
  docker logs "$container_name" || true
  docker rm -f "$container_name" >/dev/null || true
  docker logs "$fixture_container" 2>/dev/null || true
  docker rm -f "$fixture_container" >/dev/null 2>&1 || true
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
curl -fsS "$base_url/api/v1/system" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and d["reason"] and d["cpuUsage"] is None'
curl -fsS "$base_url/api/v1/storage" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and "/host/var/local/emhttp" in d["reason"]'
curl -fsS "$base_url/api/v1/docker" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and d["reason"] and d["containers"]==[] and d["summary"]=={"running":0,"stopped":0,"other":0}, d'
curl -fsS "$base_url/api/v1/capabilities" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["docker"] is False and all(d["dockerActions"][action] is False for action in ("start","stop","restart")), d'

curl -fsS "$base_url/api/v1/vms" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and d["reason"] and d["domains"]==[] and d["summary"]=={"running":0,"stopped":0,"other":0}, d'
curl -fsS "$base_url/api/v1/capabilities" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["vm"] is False and all(d["vmActions"][a] is False for a in ("start","stop","forceStop")), d'

# Only synthetic fixtures are mounted, never the CI runner's live /proc or /sys.
docker run -d --name "$fixture_container" -p 127.0.0.1::8080 \
  --mount "type=bind,src=$(pwd)/testdata/host,dst=/host,readonly" "$image_name" >/dev/null
fixture_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}' "$fixture_container")"
fixture_url="http://127.0.0.1:$fixture_port"
attempt=0
until curl -fsS "$fixture_url/healthz" -o /dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then exit 1; fi
  sleep 1
done
curl -fsS "$fixture_url/api/v1/system" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] and d["hostname"]=="Fixture-Tower" and d["memoryUsedBytes"]==6291456 and d["cpuTemperature"]==42 and d["networkInterface"]=="br0", d'
# curl 28 is expected: this is an intentionally bounded read of a live stream.
stream="$(curl -fsSN --max-time 3 "$fixture_url/api/v1/events" || test "$?" = 28)"
printf '%s' "$stream" | python3 -c 'import json,sys; text=sys.stdin.read(); samples=[json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]; assert "event: system.metrics" in text and len(samples)>=2 and all(d["available"] for d in samples) and samples[-1]["networkRXRate"]==0, text'
curl -fsS "$fixture_url/api/v1/storage" | python3 -c 'import json,sys; text=sys.stdin.read(); d=json.loads(text); assert d["available"] and d["array"]["capacity"]["totalBytes"]==10240000 and d["array"]["diskCount"]==1 and d["pools"][0]["capacity"]["totalBytes"]==2048000 and d["pools"][0]["diskCount"]==2 and d["parity"]["state"]=="idle" and d["disks"][0]["powerState"]=="active" and "csrf_token" not in text and "fixture-must-never-be-exported" not in text, text'
curl -fsS "$fixture_url/api/v1/capabilities" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["array"]["read"] and not d["array"]["start"] and not d["array"]["stop"] and d["storage"]["read"]'
echo 'Image smoke checks passed: health, frontend, asset, capabilities, host fixtures, SSE, storage, missing Docker/VM'
