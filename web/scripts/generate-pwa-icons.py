"""Generate original opaque server icons using only the Python standard library."""
from pathlib import Path
import struct
import zlib

BACKGROUND = (2, 6, 23)
CYAN = (34, 211, 238)
SURFACE = (15, 23, 42)


def rounded_rect(x, y, left, top, right, bottom, radius):
    """Return whether a point lies within a rounded rectangle."""
    dx = max(left + radius - x, 0, x - (right - radius))
    dy = max(top + radius - y, 0, y - (bottom - radius))
    return left <= x <= right and top <= y <= bottom and dx * dx + dy * dy <= radius * radius


def pixel(x, y):
    """Draw a centered two-bay server inside the maskable safe circle."""
    for top in (32, 52):
        if rounded_rect(x, y, 27, top, 73, top + 16, 4):
            if rounded_rect(x, y, 29, top + 2, 71, top + 14, 2):
                if (x - 64) ** 2 + (y - top - 8) ** 2 <= 2.4 ** 2:
                    return CYAN
                if 34 <= x <= 54 and top + 6.5 <= y <= top + 9.5:
                    return CYAN
                return SURFACE
            return CYAN
    return BACKGROUND


def chunk(kind, data):
    """Encode a PNG chunk with its CRC."""
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def write_icon(path, size):
    """Render RGB pixels with supersampling and save an opaque PNG."""
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = [pixel((x + (sx + 0.5) / 3) * 100 / size,
                             (y + (sy + 0.5) / 3) * 100 / size)
                       for sy in range(3) for sx in range(3)]
            rows.extend(round(sum(color[c] for color in samples) / 9) for c in range(3))
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                     + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    output = Path(__file__).resolve().parents[1] / "public" / "icons"
    output.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192", 192), ("icon-512", 512),
                       ("maskable-512", 512), ("apple-touch-icon", 180), ("favicon", 32)):
        write_icon(output / f"{name}.png", size)
