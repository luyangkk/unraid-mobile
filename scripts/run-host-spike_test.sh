#!/bin/sh
# Verify launcher arguments without contacting a Docker daemon or the host.
set -eu

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
launcher="$(pwd)/scripts/run-host-spike.sh"
mkdir "$test_dir/bin"
cat > "$test_dir/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >> "$SPIKE_TEST_LOG"
if [ "$1" = run ]; then
  printf '{"writeVerified":false}\n'
  exit "${SPIKE_TEST_EXIT:-0}"
fi
if [ "$1" = build ]; then
  printf 'build progress\n'
  exit "${SPIKE_TEST_BUILD_EXIT:-0}"
fi
EOF
chmod +x "$test_dir/bin/docker"
export PATH="$test_dir/bin:$PATH"
export SPIKE_TEST_LOG="$test_dir/args"
export SPIKE_TEST_DIRS=true SPIKE_TEST_SOCKETS=true

# Fail with the violated contract and keep the fake daemon isolated.
fail() {
  echo "$1" >&2
  exit 1
}

# Source the actual launcher with controlled metadata checks, without real mounts.
run_case() {
  : > "$SPIKE_TEST_LOG"
  SPIKE_IMAGE="${SPIKE_TEST_IMAGE-unraid-mobile:test}" \
    SPIKE_DOCKER_READ_ENABLED="$1" SPIKE_VM_READ_ENABLED="$2" \
    sh -c '
      test() {
        case "$1" in
          -d) command test "$SPIKE_TEST_DIRS" = true ;;
          -S) command test "$SPIKE_TEST_SOCKETS" = true ;;
          *) command test "$@" ;;
        esac
      }
      . "$1"
    ' unused "$launcher" > "$test_dir/result" 2> "$test_dir/stderr"
}

run_case false false
! rg -q -- '^--privileged$|/boot|docker.sock|/var/run/libvirt|^build$' "$SPIKE_TEST_LOG" ||
  fail "Default launcher must omit privileged, boot, optional sockets and image build"
rg -q '^unraid-mobile:test$' "$SPIKE_TEST_LOG" || fail "Prebuilt image not used"
rg -q '^SPIKE_DOCKER_READ_ENABLED=false$' "$SPIKE_TEST_LOG" || fail "Docker disabled flag missing"
rg -q '^SPIKE_VM_READ_ENABLED=false$' "$SPIKE_TEST_LOG" || fail "VM disabled flag missing"
mounts="$(sed -n '/^--mount$/{n;p;}' "$SPIKE_TEST_LOG")"
[ "$(printf '%s\n' "$mounts" | wc -l | tr -d ' ')" = 3 ] || fail "Required mounts missing"
! printf '%s\n' "$mounts" | rg -v ',readonly$' || fail "Every mount must be read-only"

run_case TRUE 1
rg -q '^SPIKE_DOCKER_READ_ENABLED=false$' "$SPIKE_TEST_LOG" || fail "Docker opt-in must be strict"
rg -q '^SPIKE_VM_READ_ENABLED=false$' "$SPIKE_TEST_LOG" || fail "VM opt-in must be strict"

run_case true true
rg -q '^SPIKE_DOCKER_READ_ENABLED=true$' "$SPIKE_TEST_LOG" || fail "Docker opt-in not forwarded"
rg -q '^SPIKE_VM_READ_ENABLED=true$' "$SPIKE_TEST_LOG" || fail "VM opt-in not forwarded"
rg -q 'src=/var/run/docker.sock.*readonly$' "$SPIKE_TEST_LOG" || fail "Enabled Docker socket mount missing"
rg -q 'src=/var/run/libvirt.*readonly$' "$SPIKE_TEST_LOG" || fail "Enabled read-only VM socket directory missing"
mounts="$(sed -n '/^--mount$/{n;p;}' "$SPIKE_TEST_LOG")"
! printf '%s\n' "$mounts" | rg -v ',readonly$' || fail "Optional mounts must be read-only"

export SPIKE_TEST_SOCKETS=false
run_case true true
! rg -q 'src=/var/run/docker.sock|src=/var/run/libvirt' "$SPIKE_TEST_LOG" ||
  fail "Missing optional sockets must not prevent JSON report"
rg -q '"writeVerified":false' "$test_dir/result" || fail "Missing sockets suppressed JSON"

export SPIKE_TEST_DIRS=false
run_case false false
! rg -q '^--mount$' "$SPIKE_TEST_LOG" || fail "Missing required directories must be left for binary checks"
rg -q '"writeVerified":false' "$test_dir/result" || fail "Missing required sources suppressed JSON"
export SPIKE_TEST_DIRS=true

export SPIKE_TEST_IMAGE=
run_case false false
rg -q '^build$' "$SPIKE_TEST_LOG" || fail "Default image must build"
! rg -q 'build progress' "$test_dir/result" || fail "Build logging contaminated JSON stdout"
rg -q 'build progress' "$test_dir/stderr" || fail "Build log not preserved on stderr"
export SPIKE_TEST_BUILD_EXIT=7
status=0
run_case false false || status=$?
[ "$status" = 7 ] || fail "Docker build error must propagate"
! rg -q '^run$' "$SPIKE_TEST_LOG" || fail "Failed image build must not run container"
export SPIKE_TEST_BUILD_EXIT=0 SPIKE_TEST_IMAGE=unraid-mobile:test

export SPIKE_TEST_EXIT=2
status=0
run_case false false || status=$?
[ "$status" = 2 ] || fail "Spike exit code must propagate"
rg -q '"writeVerified":false' "$test_dir/result" || fail "Spike stdout must be retained"
echo "Host Spike launcher checks passed"
