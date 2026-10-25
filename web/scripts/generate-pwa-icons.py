"""Generate opaque PWA icons from the user-selected local PNG using ImageMagick."""
from pathlib import Path
import struct
import subprocess
import zlib


def chunk(kind, data):
    """Encode a PNG chunk with its CRC."""
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def write_icon(source, path, size, maskable=False):
    """Resize the artwork onto an opaque square with maskable-safe margins."""
    artwork_size = min(size - 2, round(size * (0.55 if maskable else 0.96)))
    pixels = subprocess.run([
        "magick", str(source), "-resize", f"{artwork_size}x{artwork_size}",
        "-background", "#020617", "-gravity", "center", "-extent", f"{size}x{size}",
        "-alpha", "remove", "-alpha", "off", "-colorspace", "sRGB",
        "-depth", "8", "rgb:-",
    ], check=True, capture_output=True).stdout
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        rows.extend(pixels[y * size * 3:(y + 1) * size * 3])
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                     + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    web_root = Path(__file__).resolve().parents[1]
    source = web_root / "icon-source" / "unraid-2.png"
    output = web_root / "public" / "icons"
    output.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192", 192), ("icon-512", 512),
                       ("maskable-512", 512), ("apple-touch-icon", 180), ("favicon", 32)):
        write_icon(source, output / f"{name}.png", size, name == "maskable-512")
