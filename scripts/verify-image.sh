#!/bin/sh
# Run only against a local Docker daemon / CI runner. No host mounts are used.
set +x
set -eu

image_name="${1:?Usage: sh scripts/verify-image.sh IMAGE}"
container_name="unraid-mobile-smoke-$$"
fixture_container="$container_name-fixture"
auth_container="$container_name-auth"

# cleanup removes disposable containers without dumping authenticated logs.
cleanup() {
  docker logs "$container_name" || true
  docker rm -f "$container_name" >/dev/null || true
  docker logs "$fixture_container" 2>/dev/null || true
  docker rm -f "$fixture_container" >/dev/null 2>&1 || true
  docker rm -f "$auth_container" >/dev/null 2>&1 || true
}

# verify_public_frontend checks packaged PWA resources and routing without credentials.
verify_public_frontend() {
  public_url="$1"
  expected_page="$2"
  for client_path in / /docker /vm /storage /unknown/nested; do
    if [ "$(curl -fsS "$public_url$client_path")" != "$expected_page" ]; then
      echo 'Public deep link did not return the embedded shell' >&2
      exit 1
    fi
  done

  curl -fsS -i "$public_url/manifest.webmanifest" | python3 -c '
import json,sys
from email.parser import BytesParser
head,body=sys.stdin.buffer.read().split(b"\r\n\r\n",1)
status,raw_headers=head.split(b"\r\n",1)
headers=BytesParser().parsebytes(raw_headers)
assert b" 200 " in status and headers["Content-Type"]=="application/manifest+json", head
manifest=json.loads(body)
assert manifest["name"]=="Unraid Mobile" and manifest["short_name"], manifest
assert manifest["start_url"]=="/" and manifest["scope"]=="/" and manifest["display"]=="standalone", manifest
assert manifest["theme_color"] and manifest["background_color"], manifest
icons={icon["src"]:icon for icon in manifest["icons"]}
for source,size,purpose in (
    ("/icons/icon-192.png","192x192","any"),
    ("/icons/icon-512.png","512x512","any"),
    ("/icons/maskable-512.png","512x512","maskable"),
):
    icon=icons[source]
    assert icon["sizes"]==size and icon["type"]=="image/png" and purpose in icon.get("purpose","any").split(), icon
'
  for icon_name in icon-192.png icon-512.png maskable-512.png apple-touch-icon.png favicon.png; do
    curl -fsS -i "$public_url/icons/$icon_name" | python3 -c '
import sys
from email.parser import BytesParser
head,body=sys.stdin.buffer.read().split(b"\r\n\r\n",1)
status,raw_headers=head.split(b"\r\n",1)
headers=BytesParser().parsebytes(raw_headers)
assert b" 200 " in status and headers["Content-Type"]=="image/png", head
assert body.startswith(b"\x89PNG\r\n\x1a\n"), "Icon is not a PNG"
'
  done
  curl -fsS -i "$public_url/sw.js" | python3 -c '
import sys
from email.parser import BytesParser
head,body=sys.stdin.buffer.read().split(b"\r\n\r\n",1)
status,raw_headers=head.split(b"\r\n",1)
headers=BytesParser().parsebytes(raw_headers)
assert b" 200 " in status and headers["Content-Type"]=="text/javascript; charset=utf-8", head
assert headers["Cache-Control"]=="no-cache", head
assert body.strip() and not body.lstrip().startswith(b"<") and b"__WB_MANIFEST" not in body, "Worker build is missing"
'
  for missing_path in /assets/missing.js /assets/missing /missing.webmanifest \
    /missing-sw.js /icons/missing.png /icons /icons/ /sw.js/ \
    //sw.js /%73w.js /icons/%69con-192.png /icons/../sw.js; do
    status="$(curl -sS --path-as-is -o /dev/null -w '%{http_code}' "$public_url$missing_path")"
    if [ "$status" != 404 ]; then
      echo 'Missing or malformed public asset did not return 404' >&2
      exit 1
    fi
  done
}

trap cleanup EXIT
docker run -d --name "$container_name" -e APP_TOKEN= -p 127.0.0.1::8080 "$image_name" >/dev/null
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
verify_public_frontend "$base_url" "$home_page"
curl -fsS "$base_url/api/v1/capabilities" | grep -q '"docker":false'
curl -fsS "$base_url/api/v1/system" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and d["reason"] and d["cpuUsage"] is None'
curl -fsS "$base_url/api/v1/storage" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and "/host/var/local/emhttp" in d["reason"]'
curl -fsS "$base_url/api/v1/docker" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and d["reason"] and d["containers"]==[] and d["summary"]=={"running":0,"stopped":0,"other":0}, d'
curl -fsS "$base_url/api/v1/capabilities" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["docker"] is False and all(d["dockerActions"][action] is False for action in ("start","stop","restart")), d'

curl -fsS "$base_url/api/v1/vms" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] is False and d["reason"] and d["domains"]==[] and d["summary"]=={"running":0,"stopped":0,"other":0}, d'
curl -fsS "$base_url/api/v1/capabilities" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["vm"] is False and all(d["vmActions"][a] is False for a in ("start","stop","forceStop")), d'

# Only synthetic fixtures are mounted, never the CI runner's live /proc or /sys.
docker run -d --name "$fixture_container" -e APP_TOKEN= -p 127.0.0.1::8080 \
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

# Generate a disposable credential here, never use a repository or caller token.
app_token="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export APP_TOKEN="$app_token"
docker run -d --name "$auth_container" --env APP_TOKEN -p 127.0.0.1::8080 \
  --mount "type=bind,src=$(pwd)/testdata/host,dst=/host,readonly" "$image_name" >/dev/null
unset APP_TOKEN
auth_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}' "$auth_container")"
auth_url="http://127.0.0.1:$auth_port"

# auth_curl supplies the header through stdin, keeping credentials out of argv.
auth_curl() {
  printf 'header = "Authorization: Bearer %s"\n' "$app_token" |
    curl --config - "$@"
}

attempt=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$auth_url/healthz" || true)" = 204 ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo 'Authenticated container did not become healthy' >&2
    exit 1
  fi
  sleep 1
done
curl -fsS "$auth_url/" -o /dev/null
curl -fsS "$auth_url$asset_path" -o /dev/null
verify_public_frontend "$auth_url" "$home_page"

for api_path in /api //api /api/v1/capabilities /api/v1/system /api/v1/storage \
  /api/v1/docker /api/v1/vms /api/v1/events /api/v1/operations/missing \
  /api/v1/unknown //api/v1/system /api/./v1/system /api/%2e%2e/healthz \
  /outside/%2e%2e/api/v1/system /api%2fv1/system /%2fapi/v1/events \
  /icons/../api/v1/capabilities /sw.js/../api/v1/events \
  /manifest.webmanifest/../api/v1/capabilities /icons/%2e%2e/api/v1/system; do
  for method in GET POST OPTIONS; do
    status="$(curl -sS --path-as-is -X "$method" -o /dev/null -w '%{http_code}' "$auth_url$api_path")"
    if [ "$status" != 401 ]; then
      echo 'Protected API did not reject an unauthenticated request' >&2
      exit 1
    fi
  done
done
curl -sS -D - -o /dev/null "$auth_url/api/v1/capabilities" |
  python3 -c 'import sys; from email.parser import Parser; status,headers=sys.stdin.read().split("\n",1); h=Parser().parsestr(headers); assert "401" in status and h["Cache-Control"]=="no-store" and h["WWW-Authenticate"]=="Bearer" and h["Content-Type"]=="application/json; charset=utf-8" and h["Location"] is None'
curl -sS "$auth_url/api/v1/capabilities" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)=={"error":{"code":"UNAUTHORIZED","message":"Authentication required","retryable":False}}'
wrong_status="$(curl -sS -H 'Authorization: Bearer disposable-invalid' -o /dev/null -w '%{http_code}' "$auth_url/api/v1/events")"
if [ "$wrong_status" != 401 ]; then
  echo 'Protected SSE did not reject an incorrect credential' >&2
  exit 1
fi
auth_curl -fsS "$auth_url/api/v1/capabilities" |
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["storage"]["read"] and not any(d["dockerActions"].values()) and not any(d["vmActions"].values()) and not d["array"]["start"] and not d["array"]["stop"] and not d["parity"]["start"] and not d["parity"]["cancel"]'
auth_curl -fsS "$auth_url/api/v1/system" |
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] and d["hostname"]=="Fixture-Tower"'
auth_curl -fsS "$auth_url/api/v1/storage" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["available"]'
auth_curl -fsS "$auth_url/api/v1/docker" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["available"] is False'
auth_curl -fsS "$auth_url/api/v1/vms" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["available"] is False'
# Suppress the expected curl timeout diagnostic and never print stream data.
auth_stream="$(auth_curl -fsSN --max-time 3 "$auth_url/api/v1/events" 2>/dev/null || test "$?" = 28)"
printf '%s' "$auth_stream" |
  python3 -c 'import json,sys; text=sys.stdin.read(); samples=[json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]; assert "event: system.metrics" in text and len(samples)>=2 and all(d["available"] for d in samples)'
auth_logs="$(docker logs "$auth_container" 2>&1)"
if printf '%s' "$auth_logs" | grep -Fq "$app_token"; then
  echo 'Authenticated container disclosed its credential in logs' >&2
  exit 1
fi
printf '%s' "$auth_logs" | grep -q 'authentication enabled'
unset app_token auth_logs auth_stream
echo 'Image smoke checks passed: LAN/auth API, public PWA/health/assets, deep links, asset 404s, fixtures, SSE, disabled writes, missing Docker/VM'
