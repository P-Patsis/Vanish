# Draws the app icons: a ghost fading out at the bottom (no image libraries on this phone, so plain PNG writing).
# Run: python3 scripts/make_icons.py
import zlib, struct, math

def ghost(u, v, s):
    """Coverage 0/1 of the ghost shape at (u, v); s scales it about the centre (maskable icons keep a safe margin)."""
    u = (u - .5) / s + .5; v = (v - .5) / s + .5
    top = math.hypot(u - .5, v - .42) <= .23
    wave = .74 + .035 * math.cos((u - .27) / .46 * 3 * 2 * math.pi)
    body = .27 <= u <= .73 and .42 <= v <= wave
    eye = any(((u - cx) / .032) ** 2 + ((v - .45) / .05) ** 2 <= 1 for cx in (.42, .58))
    mouth = ((u - .5) / .045) ** 2 + ((v - .56) / .035) ** 2 <= 1
    return (top or body), (eye or mouth), v

def pixel(x, y, size, s):
    n = 2; acc = [0, 0, 0]
    for sy in range(n):
        for sx in range(n):
            u, v = (x + (sx + .5) / n) / size, (y + (sy + .5) / n) / size
            d = math.hypot(u - .5, v - .5)
            r, g, b = 14 + 40 * max(0, 1 - d / .7), 18 + 36 * max(0, 1 - d / .7), 44 + 90 * max(0, 1 - d / .7)   # indigo glow
            inside, dark, vv = ghost(u, v, s)
            if inside:
                fade = 1 - min(1, max(0, (vv - .45) / .3)) * .75           # the lower body is vanishing
                gr, gg, gb = (235, 240, 255) if not dark else (40, 50, 110)
                r, g, b = r + (gr - r) * fade, g + (gg - g) * fade, b + (gb - b) * fade
            acc[0] += r; acc[1] += g; acc[2] += b
    return int(acc[0] / 4), int(acc[1] / 4), int(acc[2] / 4), 255

def png(path, size, s=1.0):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size): raw += bytes(pixel(x, y, size, s))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))

png('icons/icon-192.png', 192)
png('icons/icon-512.png', 512)
png('icons/maskable-512.png', 512, .78)
