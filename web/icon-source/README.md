# Application Icon Source

The user selected `unraid-2.png` from:

https://raw.githubusercontent.com/xushier/HD-Icons/main/border-radius/unraid-2.png

Keep this original 1024×1024 PNG unchanged. It is a build source, outside
`public`, and is not served or precached.

Run `python3 web/scripts/generate-pwa-icons.py` from the repository root with
ImageMagick installed to regenerate the five local RGB PNG assets. Standard
icons preserve the artwork with a narrow margin. The maskable asset uses
55% artwork width and an opaque `#020617` background.
