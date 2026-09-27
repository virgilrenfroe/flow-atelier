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
from PIL import Image, ImageDraw

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


def _halfwidth(t, lobes):
    """Ovate envelope, t=0 at the base, t=1 at the tip. Lobes cut sinuses into it."""
    env = math.sin(max(0.0, min(1.0, t)) ** 0.72 * math.pi) ** 0.82
    env *= 0.55 + 0.45 * (1.0 - t) ** 0.25
    # Shallow sinuses — kudzu lobes are blunt and broad, not maple-thin.
    if lobes >= 3:
        env *= 1.0 - 0.26 * math.exp(-((t - 0.40) ** 2) / 0.009)
        env *= 1.0 - 0.14 * math.exp(-((t - 0.66) ** 2) / 0.006)
    elif lobes == 2:
        env *= 1.0 - 0.20 * math.exp(-((t - 0.50) ** 2) / 0.012)
    return env


def leaflet_points(length, kind, rng):
    """Broadly ovate Pueraria leaflet. kind mid is 3-lobed; laterals are asymmetric."""
    lobes = 3 if kind == "mid" else (2 if rng.random() > 0.3 else 1)
    width = length * float(rng.uniform(0.92, 1.15 if kind == "mid" else 0.98))
    steps = 18
    right, left = [], []
    for i in range(steps):
        t = i / (steps - 1)
        hw = _halfwidth(t, lobes if kind == "mid" else (2 if kind == "right" else lobes))
        hw_l = _halfwidth(t, lobes if kind == "mid" else (2 if kind == "left" else 1))
        if kind == "left":
            hw *= 0.78
        elif kind == "right":
            hw_l *= 0.78
        jitter = 1.0 + float(rng.uniform(-0.02, 0.02))
        y = t * length
        right.append((hw * width * 0.5 * jitter, y))
        left.append((-hw_l * width * 0.5 * jitter, y))
    # base → right margin → tip → left margin → base
    pts = [(0.0, 0.0)] + right + left[-2:0:-1]
    return pts, lobes


def _xform_leaflet(px, py, base, ang, length_scale=1.0):
    # py runs base→tip. ang 0 points the tip up (image -y).
    tx, ty = math.sin(ang), -math.cos(ang)
    ax, ay = math.cos(ang), math.sin(ang)
    return (
        base[0] + tx * py * length_scale + ax * px,
        base[1] + ty * py * length_scale + ay * px,
    )


def _draw_leaflet(dr, base, ang, length, kind, rgb, rng):
    pts, lobes = leaflet_points(length, kind, rng)
    poly = [_xform_leaflet(x, y, base, ang) for x, y in pts]
    fill = (*rgb, 235)
    dr.polygon(poly, fill=fill)
    rim = (min(255, rgb[0] + 8), min(255, rgb[1] + 10), min(255, rgb[2] + 4), 180)
    dr.line(poly + [poly[0]], fill=rim, width=1)
    vein = (max(0, rgb[0] - 12), max(0, rgb[1] - 16), max(0, rgb[2] - 8), 210)
    tip = _xform_leaflet(0.0, length * 0.96, base, ang)
    dr.line([base, tip], fill=vein, width=1)
    # Laterals into the lobes, not a single midrib on an ellipse.
    for t, side in ((0.38, 1.0), (0.38, -1.0), (0.62, 1.0), (0.62, -1.0)):
        if lobes < 3 and t > 0.5:
            continue
        if kind == "left" and side > 0 and t < 0.5:
            continue
        if kind == "right" and side < 0 and t < 0.5:
            continue
        origin = _xform_leaflet(0.0, length * t, base, ang)
        span = length * (0.16 if t < 0.5 else 0.10)
        end = _xform_leaflet(side * span, length * (t + 0.12), base, ang)
        dr.line([origin, end], fill=vein, width=1)


def stamp_trifoliate(base, anchor, ang, length, rgb, rng):
    S = int(length * 4.4) + 12
    sprite = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_trifoliate(ImageDraw.Draw(sprite), (S * 0.5, S * 0.5), ang, length, rgb, rng)
    paste_wrap(base, sprite, anchor[0], anchor[1])


def stamp_shelf(base, anchor, ang, width, rng):
    S = int(width * 1.55) + 8
    sprite = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_shelf(ImageDraw.Draw(sprite), (S * 0.5, S * 0.62), ang, width, rng)
    paste_wrap(base, sprite, anchor[0], anchor[1])


def draw_trifoliate(dr, anchor, ang, length, rgb, rng):
    """Three leaflets on one petiole. Center stalk is longer; laterals are short."""
    # Attachment node sits out along `ang` (0 = up).
    pet = length * float(rng.uniform(0.42, 0.62))
    node = _xform_leaflet(0.0, pet, anchor, ang)
    bronze = (
        min(255, rgb[0] + 16),
        max(0, rgb[1] - 6),
        max(0, rgb[2] - 4),
        230,
    )
    dr.line([anchor, node], fill=bronze, width=2)
    specs = (
        ("mid", ang + float(rng.uniform(-0.12, 0.12)), length, length * 0.20),
        ("left", ang + 1.05 + float(rng.uniform(-0.12, 0.15)), length * float(rng.uniform(0.72, 0.88)), length * 0.07),
        ("right", ang - 1.05 + float(rng.uniform(-0.15, 0.12)), length * float(rng.uniform(0.72, 0.88)), length * 0.07),
    )
    for kind, lang, L, pul in specs:
        base = _xform_leaflet(0.0, pul, node, lang)
        _draw_leaflet(dr, base, lang, L, kind, rgb, rng)


def paint_moss(rgb, rng):
    """Cushion moss: short upright filaments and packed tuft tips. Not blurred discs."""
    acc = np.zeros((N, N, 3), np.float32)
    wgt = np.zeros((N, N), np.float32)
    step = 13
    ny, nx = N // step, N // step
    gy, gx = np.mgrid[0:ny, 0:nx]
    cx = np.mod(gx * step + rng.uniform(0, step, (ny, nx)), N)
    cy = np.mod(gy * step + rng.uniform(0, step, (ny, nx)), N)
    for _h in range(8):
        ang = rng.normal(loc=-math.pi / 2, scale=0.48, size=(ny, nx))
        length = rng.uniform(5.0, 12.0, size=(ny, nx))
        col = np.stack(
            [
                rng.uniform(14, 26, (ny, nx)),
                rng.uniform(24, 40, (ny, nx)),
                rng.uniform(10, 18, (ny, nx)),
            ],
            axis=-1,
        )
        tip = np.clip(col + np.array([8.0, 14.0, 4.0]), 0, 70)
        for t in (0.2, 0.45, 0.7, 0.88, 1.0):
            x = np.mod(cx + np.cos(ang) * length * t, N).astype(np.int32)
            y = np.mod(cy + np.sin(ang) * length * t, N).astype(np.int32)
            c = tip if t > 0.85 else col
            np.add.at(acc[:, :, 0], (y, x), c[:, :, 0])
            np.add.at(acc[:, :, 1], (y, x), c[:, :, 1])
            np.add.at(acc[:, :, 2], (y, x), c[:, :, 2])
            np.add.at(wgt, (y, x), 1.0)
    # Finer velvet between the cushions.
    step2 = 7
    ny, nx = N // step2, N // step2
    gy, gx = np.mgrid[0:ny, 0:nx]
    cx = np.mod(gx * step2 + rng.uniform(0, step2, (ny, nx)), N)
    cy = np.mod(gy * step2 + rng.uniform(0, step2, (ny, nx)), N)
    for _h in range(4):
        ang = rng.normal(loc=-math.pi / 2, scale=0.7, size=(ny, nx))
        length = rng.uniform(2.0, 5.5, size=(ny, nx))
        col = np.stack(
            [
                rng.uniform(12, 22, (ny, nx)),
                rng.uniform(20, 34, (ny, nx)),
                rng.uniform(9, 16, (ny, nx)),
            ],
            axis=-1,
        )
        for t in (0.4, 1.0):
            x = np.mod(cx + np.cos(ang) * length * t, N).astype(np.int32)
            y = np.mod(cy + np.sin(ang) * length * t, N).astype(np.int32)
            np.add.at(acc[:, :, 0], (y, x), col[:, :, 0])
            np.add.at(acc[:, :, 1], (y, x), col[:, :, 1])
            np.add.at(acc[:, :, 2], (y, x), col[:, :, 2])
            np.add.at(wgt, (y, x), 0.8)
    m = wgt > 0
    avg = np.zeros_like(acc)
    avg[m] = acc[m] / wgt[m, None]
    out = rgb.astype(np.float32)
    out[m] = out[m] * 0.28 + avg[m] * 0.72
    return np.clip(out, 0, 255).astype(np.uint8)


def draw_shelf(dr, anchor, ang, width, rng):
    """Semicircular bracket: concentric zones on top, pore bands underneath."""
    thick = width * float(rng.uniform(0.34, 0.48))
    zones = (
        (1.00, (72, 60, 46, 235)),
        (0.72, (58, 48, 36, 240)),
        (0.46, (44, 36, 28, 245)),
        (0.22, (32, 26, 20, 250)),
    )
    for scale, col in zones:
        pts = []
        segs = 28
        for i in range(segs + 1):
            a = math.pi * i / segs
            # Flat edge along `ang`, fan opens to the left of that axis (out from the wall).
            across = (math.cos(a) - 0.0) * (width * 0.5 * scale)
            out = math.sin(a) * (thick * scale)
            tx, ty = math.cos(ang), math.sin(ang)
            ox, oy = -math.sin(ang), math.cos(ang)
            pts.append((anchor[0] + tx * across + ox * out, anchor[1] + ty * across + oy * out))
        dr.polygon(pts, fill=col)
    # Pale leathery rim, still night-dull.
    rim_pts = []
    for i in range(20):
        a = math.pi * i / 19
        across = math.cos(a) * (width * 0.5)
        out = math.sin(a) * thick
        tx, ty = math.cos(ang), math.sin(ang)
        ox, oy = -math.sin(ang), math.cos(ang)
        rim_pts.append((anchor[0] + tx * across + ox * out, anchor[1] + ty * across + oy * out))
    dr.line(rim_pts, fill=(96, 84, 66, 200), width=1)
    # Underside pores: darker arcs stacked toward the margin.
    for k, frac in enumerate((0.55, 0.70, 0.84)):
        band = []
        for i in range(16):
            a = math.pi * (0.08 + 0.84 * i / 15)
            across = math.cos(a) * (width * 0.5 * frac)
            out = math.sin(a) * (thick * frac)
            tx, ty = math.cos(ang), math.sin(ang)
            ox, oy = -math.sin(ang), math.cos(ang)
            band.append((anchor[0] + tx * across + ox * out, anchor[1] + ty * across + oy * out))
        dr.line(band, fill=(22, 16, 12, 190), width=1)


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


def make_cracks(rng):
    """Fissures a couple of centimetres wide once the tile is ~2 m on the wall."""
    crack = torus_voronoi_edge(N, 28, 22.0, rng)
    fine = torus_voronoi_edge(N, 64, 9.0, np.random.default_rng(int(rng.integers(0, 1_000_000))))
    return np.clip(np.maximum(crack, fine * 0.85), 0.0, 1.0)


def build_circuit(rng, worn, crack):
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
    # Bright enough to read in a night opening, not a neon flood.
    teal = (46, 198, 206, 255)
    amber = (214, 132, 46, 255)
    copper = (132, 84, 52, 255)

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

    grid = 84
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
            thresh = 0.74 - 0.62 * local - (0.22 if highway else 0.0)
            if h > thresh:
                col = amber if cell_hash(i, j, 4) > 0.72 else (teal if cell_hash(i, j, 5) > 0.35 else copper)
                width = 16 if highway or local > 0.4 else 9
                stroke((x0, y), (x1, y), col, width, 1.0 if col != copper else 0.7)
            x = i * grid + grid // 2
            y0 = j * grid
            y1 = y0 + grid
            v = cell_hash(i, j, 6)
            vthresh = 0.76 - 0.64 * local
            if v > vthresh:
                col = amber if cell_hash(i, j, 7) > 0.78 else (teal if cell_hash(i, j, 8) > 0.4 else copper)
                stroke((x, y0), (x, y1), col, 10 if local > 0.35 else 8, 1.0 if col != copper else 0.65)

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
    # Fissures themselves carry a trace, so a crack opens onto circuitry
    # rather than bare concrete.
    core = crack > 0.62
    band = (np.arange(N, dtype=np.int32)[:, None] // 120) & 1
    teal_m = core & (band == 0)
    amber_m = core & (band == 1)
    arr[teal_m, 0] = 46
    arr[teal_m, 1] = 198
    arr[teal_m, 2] = 206
    arr[amber_m, 0] = 214
    arr[amber_m, 1] = 132
    arr[amber_m, 2] = 46
    trace = np.maximum(trace, core.astype(np.float32))
    # alpha = trace strength. Concrete stays 0 so the shader glow is traces only.
    arr[:, :, 3] = np.clip(trace * 255.0, 0, 255).astype(np.uint8)
    return arr


def build_growth(rng, worn, crack):
    base_n = fbm(N, rng, 5, 4)
    blot = fbm(N, rng, 4, 8)
    fine = fbm(N, rng, 3, 22)
    damp = fbm(N, rng, 3, 6)
    # Dull night olive. Green stays ahead of red, but the value stays low.
    r = 20 + base_n * 16 + blot * 6
    g = 30 + base_n * 26 + blot * 8
    b = 16 + base_n * 12 + damp * 5
    r += (fine - 0.5) * 6
    g += (fine - 0.5) * 8
    b += (damp - 0.5) * 5
    # Blue-black damp pockets
    pocket = np.clip((damp - 0.62) / 0.25, 0.0, 1.0)
    r = r * (1 - 0.35 * pocket) + pocket * 10
    g = g * (1 - 0.28 * pocket) + pocket * 22
    b = b * (1 - 0.05 * pocket) + pocket * 24
    rgb = np.clip(np.stack([r, g, b], -1), 0, 255).astype(np.uint8)
    print("  moss filaments…")
    rgb = paint_moss(rgb, rng)
    img = Image.fromarray(rgb, "RGB").convert("RGBA")

    # Direction field for vines (tileable).
    ang_small = fbm(512, rng, 4, 3)
    ang = np.array(Image.fromarray((ang_small * 255).astype(np.uint8), "L").resize((N, N), Image.BILINEAR), dtype=np.float32) / 255.0
    canopy = fbm(N, rng, 3, 5)

    dr = ImageDraw.Draw(img)
    print("  kudzu vines…")
    vines = 26
    for v in range(vines):
        x = float(rng.uniform(0, N))
        y = float(rng.uniform(0, N))
        steps = int(rng.integers(100, 180))
        bias = float(rng.uniform(0.55, 1.25))
        # Young growth is golden-bronze and hairy, not a green rope.
        vine_col = (
            int(rng.integers(46, 68)),
            int(rng.integers(32, 46)),
            int(rng.integers(16, 26)),
            240,
        )
        hair_col = (
            max(0, vine_col[0] - 18),
            max(0, vine_col[1] - 12),
            max(0, vine_col[2] - 6),
            160,
        )
        leaf_rgb = (
            int(rng.integers(28, 42)),
            int(rng.integers(40, 58)),
            int(rng.integers(16, 28)),
        )
        pts = []
        leaves = []
        for s in range(steps):
            a = float(sample_wrap(ang, np.array(x), np.array(y)))
            theta = (a - 0.5) * 2.1 + math.pi * 0.5 * bias
            step = float(rng.uniform(8.0, 13.0))
            x2 = (x + math.cos(theta) * step) % N
            y2 = (y + math.sin(theta) * step) % N
            if abs(x2 - x) < N * 0.5 and abs(y2 - y) < N * 0.5:
                pts.append((x, y, x2, y2))
            x, y = x2, y2
            # Alternate trifoliates along the stem. Denser where the canopy noise is high.
            dense = float(sample_wrap(canopy, np.array(x), np.array(y))) > 0.58
            every = 3 if dense else 5
            if s % every == 2 and s > 2:
                side = 1.0 if (s // every) % 2 == 0 else -1.0
                leaf_ang = theta + side * float(rng.uniform(0.85, 1.25))
                # Droop toward downward so the wall reads as hanging kudzu.
                leaf_ang = leaf_ang * 0.72 + (math.pi / 2) * 0.28
                length = float(rng.uniform(34, 66 if dense else 56))
                leaves.append((x, y, leaf_ang, length))
        for x0, y0, x1, y1 in pts:
            dr.line([(x0 + 1, y0), (x1 + 1, y1)], fill=hair_col, width=1)
            dr.line([(x0, y0), (x1, y1)], fill=vine_col, width=2)
        for lx, ly, lang, length in leaves:
            # Draw directly so the lobe silhouette is not resampled soft.
            stamp_trifoliate(img, (lx, ly), lang, length, leaf_rgb, rng)

    # Leafy mats in a few canopy patches, still night-olive.
    print("  canopy patches…")
    for _c in range(7):
        cx = float(rng.uniform(0, N))
        cy = float(rng.uniform(0, N))
        leaf_rgb = (
            int(rng.integers(30, 44)),
            int(rng.integers(42, 60)),
            int(rng.integers(16, 26)),
        )
        for _k in range(16):
            jx = cx + float(rng.uniform(-70, 70))
            jy = cy + float(rng.uniform(-90, 50))
            stamp_trifoliate(
                img,
                (jx % N, jy % N),
                float(rng.uniform(-0.6, 0.6)) + math.pi / 2,
                float(rng.uniform(36, 68)),
                leaf_rgb,
                rng,
            )

    print("  shelf fungus…")
    for _c in range(12):
        cx = float(rng.uniform(0, N))
        cy = float(rng.uniform(0, N))
        shelves = int(rng.integers(3, 6))
        hang = float(rng.uniform(-0.35, 0.35))
        for s in range(shelves):
            stamp_shelf(
                img,
                (cx, cy + s * float(rng.uniform(7, 12))),
                hang,
                float(rng.uniform(40, 92)),
                rng,
            )

    arr = np.array(img).astype(np.float32)
    # Crevice darkening along cracks, applied after the draw so vines sit in the mat.
    shade = 1.0 - 0.28 * np.clip(crack, 0.0, 1.0)
    arr[:, :, 0] *= shade
    arr[:, :, 1] *= shade
    arr[:, :, 2] *= shade
    # Night cap. Local contrast (veins, filaments, shelf zones) stays;
    # nothing climbs into a bright green flood.
    arr[:, :, 0] = np.minimum(arr[:, :, 0] * 0.92, 56.0)
    arr[:, :, 1] = np.minimum(arr[:, :, 1] * 0.90, 62.0)
    arr[:, :, 2] = np.minimum(arr[:, :, 2] * 0.92, 46.0)

    # Hard openings only — the soft voronoi shoulder was a circuit haze.
    crack_open = np.clip((crack - 0.66) / 0.24, 0.0, 1.0)
    worn_open = np.clip((worn - 0.55) / 0.28, 0.0, 1.0)
    cover = 252.0 - np.maximum(crack_open, worn_open) * 250.0
    arr[:, :, 3] = np.clip(cover, 0.0, 255.0)
    return np.clip(arr, 0, 255).astype(np.uint8)


def preview(circuit, growth, path):
    c = circuit[:, :, :3].astype(np.float32)
    g = growth[:, :, :3].astype(np.float32)
    a = growth[:, :, 3:4].astype(np.float32) / 255.0
    mix = c * (1.0 - a) + g * a
    tr = circuit[:, :, 3:4].astype(np.float32) / 255.0
    mix = np.clip(mix + c * tr * (1.0 - a) * 0.25, 0, 255).astype(np.uint8)
    g8 = np.clip(g, 0, 255).astype(np.uint8)
    Image.fromarray(g8).resize((768, 768), Image.BOX).save(path.replace(".png", "-growth.jpg"), quality=90)
    Image.fromarray(mix).resize((768, 768), Image.BOX).save(path.replace(".png", "-composite.jpg"), quality=90)
    Image.fromarray(g8[400:1100, 300:1100]).save(path.replace(".png", "-growth-close.png"))
    Image.fromarray(mix[400:1100, 300:1100]).save(path.replace(".png", "-composite-close.png"))
    open_frac = float((growth[:, :, 3] < 80).mean())
    mid_frac = float((growth[:, :, 3] < 160).mean())
    trace_frac = float((circuit[:, :, 3] > 40).mean())
    print(f"growth alpha mean {growth[:,:,3].mean():.1f}  open<80 {open_frac:.3f}  <160 {mid_frac:.3f}")
    print(f"circuit trace frac {trace_frac:.3f}  rgb mean {circuit[:,:,:3].mean(axis=(0,1))}")
    print(f"growth rgb mean {growth[:,:,:3].mean(axis=(0,1))} max {g8.max(axis=(0,1))}")


def main():
    rng = np.random.default_rng(0x4D4F5353)  # MOSS
    print("worn mask…")
    worn = worn_mask(rng)
    print("cracks…")
    crack = make_cracks(rng)
    print("circuit…")
    circuit = build_circuit(rng, worn, crack)
    print("growth…")
    growth = build_growth(rng, worn, crack)
    cpath = os.path.join(ROOT, "facade-circuit.png")
    gpath = os.path.join(ROOT, "facade-growth.png")
    Image.fromarray(circuit, "RGBA").save(cpath, optimize=True, compress_level=9)
    Image.fromarray(growth, "RGBA").save(gpath, optimize=True, compress_level=9)
    preview(circuit, growth, os.path.join("/tmp", "sheath-preview.png"))
    print("wrote", cpath, os.path.getsize(cpath))
    print("wrote", gpath, os.path.getsize(gpath))


if __name__ == "__main__":
    main()
