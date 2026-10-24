#!/bin/sh
set -eu

image_name="unraid-mobile:host-spike"

docker build -t "$image_name" .

docker run --rm \
  --privileged \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/run/libvirt:/var/run/libvirt \
  -v /boot:/host/boot:ro \
  -v /var/local/emhttp:/host/var/local/emhttp \
  --entrypoint /app/host-spike \
  "$image_name"
