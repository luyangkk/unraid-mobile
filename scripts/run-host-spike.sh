#!/bin/sh
set -eu

image_name="${SPIKE_IMAGE:-unraid-mobile:host-spike}"
if [ -z "${SPIKE_IMAGE:-}" ]; then
  docker build -t "$image_name" . >&2
fi

# Normalize optional probes; only the exact value true enables a reader.
docker_enabled=false
vm_enabled=false
[ "${SPIKE_DOCKER_READ_ENABLED:-false}" != true ] || docker_enabled=true
[ "${SPIKE_VM_READ_ENABLED:-false}" != true ] || vm_enabled=true

set -- --rm \
  -e "SPIKE_DOCKER_READ_ENABLED=$docker_enabled" \
  -e "SPIKE_VM_READ_ENABLED=$vm_enabled"

# Missing sources remain absent inside the container for the binary to diagnose.
if test -d /proc; then
  set -- "$@" --mount type=bind,src=/proc,dst=/host/proc,readonly
fi
if test -d /sys; then
  set -- "$@" --mount type=bind,src=/sys,dst=/host/sys,readonly
fi
if test -d /var/local/emhttp; then
  set -- "$@" --mount type=bind,src=/var/local/emhttp,dst=/host/var/local/emhttp,readonly
fi
if [ "$docker_enabled" = true ] && test -S /var/run/docker.sock; then
  set -- "$@" --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly
fi
if [ "$vm_enabled" = true ] && test -S /var/run/libvirt/libvirt-sock-ro; then
  set -- "$@" --mount type=bind,src=/var/run/libvirt,dst=/var/run/libvirt,readonly
fi

exec docker run "$@" --entrypoint /app/host-spike "$image_name"
