#!/usr/bin/env python3
"""Tileable dual sheath for Harbor concrete façades.

facade-circuit.png  — night concrete with sparse circuit traces (alpha = trace)
facade-growth.png   — moss / kudzu / fungus (alpha = cover; low alpha = peek)

Both tiles share worn-patch placement so an opening in the growth reveals
circuitry, not empty concrete. Seamless on the torus.
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

N = 2048
ROOT = os.path.dirname(os.path.abspath(__file__))


def fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def value_noise(n, period, rng):
    period = max(2, int(period))
    lat = rng.random((period, period), dtype=np.float32)
    ys = np.linspace(0.0, period, n, endpoint=False, dtype=np.float32)
    xs = np.linspace(0.0, period, n, endpoint=False, dtype=np.float32)
    x, y = np.meshgrid(xs, ys)
    x0 = np.floor(x).astype(np.int32) % period
    y0 = np.floor(y).astype(np.int32) % period
    x1 = (x0 + 1) % period
    y1 = (y0 + 1) % period
    fx = fade((x - np.floor(x)).astype(np.float32))
    fy = fade((y - np.floor(y)).astype(np.float32))
    n00 = lat[y0, x0]
    n10 = lat[y0, x1]
    n01 = lat[y1, x0]
    n11 = lat[y1, x1]
    return (
        n00 * (1.0 - fx) * (1.0 - fy)
        + n10 * fx * (1.0 - fy)
        + n01 * (1.0 - fx) * fy
        + n11 * fx * fy
    )


def fbm(n, rng, octaves, base_period):
    acc = np.zeros((n, n), np.float32)
    amp = 0.5
    total = 0.0
    period = base_period
    for _ in range(octaves):
        acc += amp * value_noise(n, period, rng)
        total += amp
        amp *= 0.5
        period = min(n // 2, max(2, int(period * 2)))
    return acc / total


def sample_wrap(field, x, y):
    h, w = field.shape
    x = np.mod(x, w)
    y = np.mod(y, h)
    x0 = np.floor(x).astype(np.int32) % w
    y0 = np.floor(y).astype(np.int32) % h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    fx = (x - np.floor(x)).astype(np.float32)
    fy = (y - np.floor(y)).astype(np.float32)
    return (
        field[y0, x0] * (1 - fx) * (1 - fy)
        + field[y0, x1] * fx * (1 - fy)
        + field[y1, x0] * (1 - fx) * fy
        + field[y1, x1] * fx * fy
    )


def cell_hash(i, j, salt):
    n = (int(i) * 374761393 + int(j) * 668265263 + int(salt) * 1442695041) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296.0


def torus_voronoi_edge(n, nseeds, width, rng):
    seeds = rng.random((nseeds, 2), dtype=np.float32) * n
    edge = np.zeros((n, n), np.float32)
    strip = 96
    for y0 in range(0, n, strip):
        y1 = min(n, y0 + strip)
        yy = np.arange(y0, y1, dtype=np.float32)[:, None, None]
        xx = np.arange(n, dtype=np.float32)[None, :, None]
        sy = seeds[:, 1][None, None, :]
        sx = seeds[:, 0][None, None, :]
        dy = np.abs(yy - sy)
        dx = np.abs(xx - sx)
        dy = np.minimum(dy, n - dy)
        dx = np.minimum(dx, n - dx)
        d = np.sqrt(dx * dx + dy * dy)
        d.sort(axis=2)
        gap = d[:, :, 1] - d[:, :, 0]
        edge[y0:y1] = np.clip(1.0 - gap / width, 0.0, 1.0)
    return edge


def paste_wrap(base, sprite, x, y):
    w, h = base.size
    sw, sh = sprite.size
    x = int(round(x - sw * 0.5))
    y = int(round(y - sh * 0.5))
    offsets = [(0, 0)]
    if x < 0 or x + sw > w or y < 0 or y + sh > h:
        offsets = [(ox, oy) for ox in (0, -w, w) for oy in (0, -h, h)]
    for ox, oy in offsets:
        base.alpha_composite(sprite, (x + ox, y + oy))


def make_leaf(length, width, rgb, rng):
    img = Image.new("RGBA", (length + 4, width + 4), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    cx, cy = img.size[0] // 2, img.size[1] // 2
    dr.ellipse(
        [cx - length // 2, cy - width // 2, cx + length // 2, cy + width // 2],
        fill=(*rgb, 230),
    )
    # midrib
    rib = tuple(max(0, c - 28) for c in rgb)
    dr.line([(cx - length // 3, cy), (cx + length // 3, cy)], fill=(*rib, 180), width=1)
    # lighter rim on one side
    hi = tuple(min(255, c + 22) for c in rgb)
    dr.arc(
        [cx - length // 2, cy - width // 2, cx + length // 2, cy + width // 2],
        start=200, end=340, fill=(*hi, 160), width=1,
    )
    return img


def rotate_sprite(sprite, angle_deg):
    return sprite.rotate(angle_deg, resample=Image.BICUBIC, expand=True)


def worn_mask(rng):
    """Soft openings shared by both sheets. ~0.10–0.16 of the tile."""
    low = fbm(N, rng, 4, 5)
    mid = fbm(N, rng, 3, 9)
    worn = np.clip((low - 0.58) / 0.16, 0.0, 1.0)
    worn = np.maximum(worn, np.clip((mid - 0.70) / 0.12, 0.0, 1.0) * 0.65)
    # a handful of ragged rectangles (flaked sheath)
    yy, xx = np.mgrid[0:N, 0:N]
    for k in range(6):
        cx = int(rng.integers(0, N))
        cy = int(rng.integers(0, N))
        rw = int(rng.integers(70, 210))
        rh = int(rng.integers(48, 160))
        dx = np.minimum(np.abs(xx - cx), N - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), N - np.abs(yy - cy))
        rect = np.clip(1.0 - np.maximum(dx / rw, dy / rh), 0.0, 1.0)
        # ragged edge
        jitter = fbm(N, rng, 2, 18)
        rect = np.clip((rect - 0.08) * (0.65 + jitter), 0.0, 1.0)
        worn = np.maximum(worn, rect * float(rng.uniform(0.75, 1.0)))
    return np.clip(worn, 0.0, 1.0)


def build_circuit(rng, worn):
    concrete_n = fbm(N, rng, 5, 4)
    fine = fbm(N, rng, 3, 28)
    stain = fbm(N, rng, 3, 7)
    # Night concrete, cool, close to the existing façade body.
    r = 22 + concrete_n * 16 + (fine - 0.5) * 8 + (stain - 0.5) * 6
    g = 26 + concrete_n * 14 + (fine - 0.5) * 7 + (stain - 0.5) * 4
    b = 34 + concrete_n * 18 + (fine - 0.5) * 6 - (stain - 0.5) * 5
    # Horizontal formwork / pour lines
    y = np.arange(N, dtype=np.float32)[:, None]
    pour = np.exp(-((y % 196) - 2.0) ** 2 / 3.2)
    r -= pour * 7
    g -= pour * 6
    b -= pour * 4
    # Slightly richer circuitry waiting under worn patches
    r = r * (1.0 - 0.08 * worn) + worn * 8
    g = g * (1.0 - 0.05 * worn)
    b = b * (1.0 - 0.02 * worn) + worn * 6
    rgb = np.stack([r, g, b], axis=-1)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB").convert("RGBA")
    draw = ImageDraw.Draw(img)

    trace = np.zeros((N, N), np.float32)
    teal = (36, 168, 176, 255)
    amber = (196, 118, 42, 255)
    copper = (120, 78, 48, 255)

    def stroke(p0, p1, color, width, strength):
        draw.line([p0, p1], fill=color, width=width)
        x0, y0 = p0
        x1, y1 = p1
        # raster into the mask approximately (axis-aligned segments only)
        if y0 == y1:
            xa, xb = sorted((int(x0), int(x1)))
            y = int(y0) % N
            y0b = max(0, y - width)
            y1b = min(N, y + width + 1)
            xa %= N
            xb %= N
            if xa <= xb:
                trace[y0b:y1b, xa:xb + 1] = np.maximum(trace[y0b:y1b, xa:xb + 1], strength)
            else:
                trace[y0b:y1b, xa:] = np.maximum(trace[y0b:y1b, xa:], strength)
                trace[y0b:y1b, : xb + 1] = np.maximum(trace[y0b:y1b, : xb + 1], strength)
        elif x0 == x1:
            ya, yb = sorted((int(y0), int(y1)))
            x = int(x0) % N
            x0b = max(0, x - width)
            x1b = min(N, x + width + 1)
            ya %= N
            yb %= N
            if ya <= yb:
                trace[ya:yb + 1, x0b:x1b] = np.maximum(trace[ya:yb + 1, x0b:x1b], strength)
            else:
                trace[ya:, x0b:x1b] = np.maximum(trace[ya:, x0b:x1b], strength)
                trace[: yb + 1, x0b:x1b] = np.maximum(trace[: yb + 1, x0b:x1b], strength)

    grid = 48
    cells = N // grid
    # Sparse Manhattan traces. Highways on a few rows/cols.
    for j in range(cells):
        highway = cell_hash(0, j, 11) > 0.82
        for i in range(cells):
            y = j * grid + grid // 2
            x0 = i * grid
            x1 = x0 + grid
            h = cell_hash(i, j, 3)
            # denser under worn openings (sample center of the segment)
            wx = min(N - 1, x0 + grid // 2)
            wy = min(N - 1, y)
            local = float(worn[wy, wx])
            thresh = 0.78 - 0.28 * local - (0.18 if highway else 0.0)
            if h > thresh:
                col = amber if cell_hash(i, j, 4) > 0.72 else (teal if cell_hash(i, j, 5) > 0.35 else copper)
                width = 3 if highway or local > 0.45 else 2
                stroke((x0, y), (x1, y), col, width, 1.0 if col != copper else 0.55)
            x = i * grid + grid // 2
            y0 = j * grid
            y1 = y0 + grid
            v = cell_hash(i, j, 6)
            vthresh = 0.80 - 0.30 * local
            if v > vthresh:
                col = amber if cell_hash(i, j, 7) > 0.78 else (teal if cell_hash(i, j, 8) > 0.4 else copper)
                stroke((x, y0), (x, y1), col, 2, 1.0 if col != copper else 0.5)

    # Vias and a few dark IC pads — pads stay matte, pins carry the glint.
    via_r = 5
    for j in range(cells):
        for i in range(cells):
            if cell_hash(i, j, 9) < 0.86:
                continue
            x = i * grid + grid // 2
            y = j * grid + grid // 2
            draw.ellipse([x - via_r, y - via_r, x + via_r, y + via_r], outline=teal, width=2)
            draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(12, 16, 20, 255))
            trace[max(0, y - via_r): min(N, y + via_r + 1), max(0, x - via_r): min(N, x + via_r + 1)] = np.maximum(
                trace[max(0, y - via_r): min(N, y + via_r + 1), max(0, x - via_r): min(N, x + via_r + 1)],
                0.85,
            )

    for k in range(7):
        i = int(rng.integers(1, cells - 2))
        j = int(rng.integers(1, cells - 2))
        x = i * grid + 8
        y = j * grid + 10
        w = int(rng.integers(36, 78))
        h = int(rng.integers(22, 48))
        draw.rounded_rectangle([x, y, x + w, y + h], radius=3, fill=(14, 18, 22, 255), outline=(48, 62, 58, 255))
        pins = max(3, w // 10)
        for p in range(pins):
            px = x + 6 + p * ((w - 12) / max(1, pins - 1))
            draw.line([(px, y - 5), (px, y)], fill=teal, width=1)
            draw.line([(px, y + h), (px, y + h + 5)], fill=amber if p % 4 == 0 else teal, width=1)
            xi = int(px)
            trace[max(0, y - 6): y + 1, max(0, xi - 1): min(N, xi + 2)] = 1.0
            trace[y + h: min(N, y + h + 6), max(0, xi - 1): min(N, xi + 2)] = 0.9

    arr = np.array(img)
    # alpha = trace strength. Concrete stays 0 so the shader glow is traces only.
    arr[:, :, 3] = np.clip(trace * 255.0, 0, 255).astype(np.uint8)
    return arr


def build_growth(rng, worn):
    base_n = fbm(N, rng, 5, 4)
    blot = fbm(N, rng, 4, 8)
    fine = fbm(N, rng, 3, 22)
    damp = fbm(N, rng, 3, 6)
    # Deep wet olive. Local contrast so leaves and shelves survive night grade.
    r = 16 + base_n * 22 + blot * 10
    g = 28 + base_n * 36 + blot * 14
    b = 14 + base_n * 16 + damp * 8
    r += (fine - 0.5) * 10
    g += (fine - 0.5) * 14
    b += (damp - 0.5) * 8
    # Blue-black damp pockets
    pocket = np.clip((damp - 0.62) / 0.25, 0.0, 1.0)
    r = r * (1 - 0.35 * pocket) + pocket * 10
    g = g * (1 - 0.28 * pocket) + pocket * 22
    b = b * (1 - 0.05 * pocket) + pocket * 24
    rgb = np.clip(np.stack([r, g, b], -1), 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB").convert("RGBA")

    # Direction field for vines (tileable).
    ang_small = fbm(512, rng, 4, 3)
    ang = np.array(Image.fromarray((ang_small * 255).astype(np.uint8), "L").resize((N, N), Image.BILINEAR), dtype=np.float32) / 255.0

    vines = 46
    for v in range(vines):
        x = float(rng.uniform(0, N))
        y = float(rng.uniform(0, N))
        steps = int(rng.integers(90, 220))
        width = float(rng.uniform(5.0, 13.0))
        # hanging bias: mostly downward, some lateral creep
        bias = float(rng.uniform(0.35, 1.15))
        vine_col = (
            int(rng.integers(28, 58)),
            int(rng.integers(36, 62)),
            int(rng.integers(16, 30)),
            255,
        )
        leaf_rgb = (
            int(rng.integers(36, 78)),
            int(rng.integers(64, 118)),
            int(rng.integers(22, 48)),
        )
        pts = []
        for s in range(steps):
            a = float(sample_wrap(ang, np.array(x), np.array(y)))
            theta = (a - 0.5) * 2.4 + math.pi * 0.5 * bias
            step = float(rng.uniform(7.0, 12.0))
            x2 = (x + math.cos(theta) * step) % N
            y2 = (y + math.sin(theta) * step) % N
            # split wrap so the stroke doesn't cut across the tile
            if abs(x2 - x) < N * 0.5 and abs(y2 - y) < N * 0.5:
                pts.append((x, y, x2, y2))
            x, y = x2, y2
            if s % 7 == 3:
                # leaf off the tangent
                leaf = make_leaf(
                    int(rng.integers(16, 34)),
                    int(rng.integers(8, 16)),
                    leaf_rgb,
                    rng,
                )
                leaf = rotate_sprite(leaf, math.degrees(theta) + float(rng.uniform(-40, 40)))
                paste_wrap(img, leaf, x, y)
        dr = ImageDraw.Draw(img)
        wpx = max(2, int(width))
        for x0, y0, x1, y1 in pts:
            dr.line([(x0, y0), (x1, y1)], fill=vine_col, width=wpx)
            # tapered highlight
            if wpx > 4 and cell_hash(int(x0), int(y0), v + 1) > 0.6:
                hi = (min(255, vine_col[0] + 18), min(255, vine_col[1] + 26), min(255, vine_col[2] + 8), 220)
                dr.line([(x0, y0), (x1, y1)], fill=hi, width=1)

    # Moss tufts
    dr = ImageDraw.Draw(img)
    for _ in range(280):
        x = float(rng.uniform(0, N))
        y = float(rng.uniform(0, N))
        rad = float(rng.uniform(6, 28))
        col = (
            int(rng.integers(18, 52)),
            int(rng.integers(40, 92)),
            int(rng.integers(16, 40)),
            int(rng.integers(150, 220)),
        )
        sprite = Image.new("RGBA", (int(rad * 2 + 2), int(rad * 2 + 2)), (0, 0, 0, 0))
        ImageDraw.Draw(sprite).ellipse([1, 1, sprite.size[0] - 2, sprite.size[1] - 2], fill=col)
        sprite = sprite.filter(ImageFilter.GaussianBlur(radius=1.2))
        paste_wrap(img, sprite, x, y)

    # Shelf fungus — pale, sparse, so the wall stays moss-dark with bone catches.
    for c in range(14):
        cx = float(rng.uniform(0, N))
        cy = float(rng.uniform(0, N))
        shelves = int(rng.integers(3, 6))
        for s in range(shelves):
            w = float(rng.uniform(28, 78))
            h = float(rng.uniform(7, 14))
            yy = cy + s * float(rng.uniform(6, 11))
            bone = (
                int(rng.integers(118, 168)),
                int(rng.integers(96, 132)),
                int(rng.integers(62, 92)),
                int(rng.integers(210, 250)),
            )
            sprite = Image.new("RGBA", (int(w + 8), int(h + 10)), (0, 0, 0, 0))
            sd = ImageDraw.Draw(sprite)
            sd.ellipse([2, 2, w, h + 2], fill=bone)
            gill = (max(0, bone[0] - 50), max(0, bone[1] - 40), max(0, bone[2] - 24), 200)
            sd.arc([3, 2, w - 1, h + 4], start=20, end=160, fill=gill, width=1)
            paste_wrap(img, sprite, cx, yy)
        # dark cup underneath the cluster
        cup = Image.new("RGBA", (36, 18), (0, 0, 0, 0))
        ImageDraw.Draw(cup).ellipse([2, 2, 34, 16], fill=(12, 18, 12, 160))
        paste_wrap(img, cup, cx, cy + shelves * 8)

    # Dead vine scraps
    dr = ImageDraw.Draw(img)
    for _ in range(80):
        x = float(rng.uniform(0, N))
        y = float(rng.uniform(0, N))
        ang = float(rng.uniform(0, math.pi))
        length = float(rng.uniform(18, 60))
        x2 = x + math.cos(ang) * length
        y2 = y + math.sin(ang) * length
        if abs(x2 - x) < N * 0.5 and abs(((y2 % N) - y)) < N * 0.5:
            dr.line(
                [(x, y), (x2 % N, y2 % N)],
                fill=(62, 44, 28, 180),
                width=int(rng.integers(1, 3)),
            )

    arr = np.array(img).astype(np.float32)
    # Crevice darkening along cracks, applied after the draw so vines sit in the mat.
    crack = torus_voronoi_edge(N, 42, 3.2, rng)
    fine_crack = torus_voronoi_edge(N, 90, 1.6, np.random.default_rng(rng.integers(0, 1_000_000)))
    crack = np.clip(crack + fine_crack * 0.85, 0.0, 1.0)
    shade = 1.0 - 0.42 * crack
    arr[:, :, 0] *= shade
    arr[:, :, 1] *= shade
    arr[:, :, 2] *= shade * (1.0 - 0.08 * crack)

    # Cover: mostly closed. Cracks and shared worn patches open onto the circuit.
    cover = 232 + fbm(N, rng, 3, 10) * 23
    cover -= crack * 210
    cover -= worn * 195
    # fray inside worn patches stays ragged rather than a clean hole
    cover += (1.0 - crack) * worn * 28
    cover = np.clip(cover, 6, 255)
    arr[:, :, 3] = cover
    return np.clip(arr, 0, 255).astype(np.uint8), crack, worn


def preview(circuit, growth, path):
    c = circuit[:, :, :3].astype(np.float32)
    g = growth[:, :, :3].astype(np.float32)
    a = growth[:, :, 3:4].astype(np.float32) / 255.0
    mix = c * (1.0 - a) + g * a
    # modest trace lift where open
    tr = circuit[:, :, 3:4].astype(np.float32) / 255.0
    mix = np.clip(mix + c * tr * (1.0 - a) * 0.25, 0, 255)
    # show a 1024 crop of the composite plus a strip of each layer
    crop = mix[:1024, :1024].astype(np.uint8)
    under = c[:512, :1024].astype(np.uint8)
    over = g[:512, :1024].astype(np.uint8)
    sheet = np.concatenate([crop, np.concatenate([under, over], axis=0)[:, :1024]], axis=0)
    # The concat above is messy if shapes differ. Build explicitly.
    top = mix[:768, :1536].astype(np.uint8)
    bot_l = c[768:1280, :768].astype(np.uint8)
    bot_r = g[768:1280, :768].astype(np.uint8)
    bot = np.concatenate([bot_l, bot_r], axis=1)
    sheet = np.concatenate([top, bot], axis=0)
    Image.fromarray(sheet, "RGB").save(path, optimize=True)
    open_frac = float((growth[:, :, 3] < 80).mean())
    mid_frac = float((growth[:, :, 3] < 160).mean())
    trace_frac = float((circuit[:, :, 3] > 40).mean())
    print(f"growth alpha mean {growth[:,:,3].mean():.1f}  open<80 {open_frac:.3f}  <160 {mid_frac:.3f}")
    print(f"circuit trace frac {trace_frac:.3f}  rgb mean {circuit[:,:,:3].mean(axis=(0,1))}")
    print(f"growth rgb mean {growth[:,:,:3].mean(axis=(0,1))}")


def main():
    rng = np.random.default_rng(0x4D4F5353)  # MOSS
    print("worn mask…")
    worn = worn_mask(rng)
    print("circuit…")
    circuit = build_circuit(rng, worn)
    print("growth…")
    growth, crack, worn = build_growth(rng, worn)
    cpath = os.path.join(ROOT, "facade-circuit.png")
    gpath = os.path.join(ROOT, "facade-growth.png")
    Image.fromarray(circuit, "RGBA").save(cpath, optimize=True, compress_level=9)
    Image.fromarray(growth, "RGBA").save(gpath, optimize=True, compress_level=9)
    preview(circuit, growth, os.path.join("/tmp", "sheath-preview.png"))
    print("wrote", cpath, os.path.getsize(cpath))
    print("wrote", gpath, os.path.getsize(gpath))


if __name__ == "__main__":
    main()
