#!/usr/bin/env python3
"""Shared Harbor street-clutter atlas.

2048², 4×4. Row 0 is the top of the PNG — same cell grammar as street-atlas
(sample with a V flip). One sheet for every first-pass prop. Marks are only
HARBOR / SIGNAL / QUAY / FENESTRA.

  row0  manhole | can metal | bag plastic | tree-pit soil
  row1  inlet grate | dumpster panel | litter paper | planter concrete
  row2  gutter grate | bin lid | bench timber | weeds (alpha)
  row3  inlet throat | cardboard | bench iron | hydrant paint
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

N = 512
SHEET = N * 4
ROOT = os.path.dirname(os.path.abspath(__file__))
RNG = np.random.default_rng(0xC1077E2)


def font(size, bold=False):
    name = "JetBrainsMono-Bold.ttf" if bold else "JetBrainsMono-Regular.ttf"
    candidates = [
        f"/usr/share/fonts/truetype/jetbrains-mono/{name}",
        f"/usr/share/fonts/truetype/JetBrainsMono/{name}",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def value_noise(n, period, rng):
    period = max(2, int(period))
    lat = rng.random((period + 1, period + 1), dtype=np.float32)
    ys = np.linspace(0.0, period, n, endpoint=False, dtype=np.float32)
    xs = np.linspace(0.0, period, n, endpoint=False, dtype=np.float32)
    x, y = np.meshgrid(xs, ys)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = fade((x - x0).astype(np.float32))
    fy = fade((y - y0).astype(np.float32))
    x0 = x0 % period
    y0 = y0 % period
    x1 = (x0 + 1) % period
    y1 = (y0 + 1) % period
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


def fbm(n, rng, octaves=5, base=4):
    acc = np.zeros((n, n), np.float32)
    amp = 0.5
    total = 0.0
    period = base
    for _ in range(octaves):
        acc += amp * value_noise(n, period, rng)
        total += amp
        amp *= 0.5
        period = min(n // 2, max(2, int(period * 2.05)))
    return acc / total


def grain(n, rng, amount=0.04):
    return (rng.random((n, n), dtype=np.float32) - 0.5) * amount


def rgb(color, field):
    img = np.zeros((N, N, 3), np.float32)
    for i, c in enumerate(color):
        img[:, :, i] = c
    if isinstance(field, np.ndarray):
        img += field[:, :, None]
    return np.clip(img, 0.0, 1.0)


def to_image(arr, alpha=None):
    rgb8 = (np.clip(arr, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    if alpha is None:
        alpha = np.full((N, N), 255, np.uint8)
    elif alpha.dtype != np.uint8:
        alpha = (np.clip(alpha, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    rgba = np.dstack([rgb8, alpha])
    return Image.fromarray(rgba, "RGBA")


def scratches(arr, rng, n=18, dark=0.08):
    yy, xx = np.mgrid[0:N, 0:N]
    for _ in range(n):
        x0 = rng.uniform(0, N)
        y0 = rng.uniform(0, N)
        ang = rng.uniform(0, math.pi)
        length = rng.uniform(N * 0.15, N * 0.7)
        half = rng.uniform(0.6, 1.6)
        dx = math.cos(ang)
        dy = math.sin(ang)
        t = (xx - x0) * dx + (yy - y0) * dy
        p = (xx - x0) * -dy + (yy - y0) * dx
        mask = (t > 0) & (t < length) & (np.abs(p) < half)
        arr[mask] *= 1.0 - dark * rng.uniform(0.4, 1.0)
    return arr


def stain(arr, rng, tint, n=4, strength=0.35):
    yy, xx = np.mgrid[0:N, 0:N]
    for _ in range(n):
        cx = rng.uniform(0.1 * N, 0.9 * N)
        cy = rng.uniform(0.1 * N, 0.9 * N)
        rx = rng.uniform(0.08 * N, 0.28 * N)
        ry = rng.uniform(0.05 * N, 0.22 * N)
        blob = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
        m = np.clip(1.0 - blob, 0, 1) ** 1.6
        for i, c in enumerate(tint):
            arr[:, :, i] = arr[:, :, i] * (1 - m * strength) + c * m * strength
    return arr


def draw_mark(base, text, xy, size, fill, rotate=0, wear=0.22):
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = font(size, bold=True)
    draw.text(xy, text, font=f, fill=fill)
    if rotate:
        layer = layer.rotate(rotate, resample=Image.BICUBIC, center=xy)
    speckle = RNG.random((N, N))
    alpha = np.array(layer.split()[-1]).astype(np.float32)
    alpha *= np.where(speckle > wear, 1.0, 0.25).astype(np.float32)
    # chipped horizontal gaps so the mark reads as a worn stencil
    gap = (np.arange(N)[:, None] % 17) < 1
    alpha *= np.where(gap, 0.35, 1.0)
    layer.putalpha(Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8)))
    return Image.alpha_composite(base, layer)


def finish(arr, rng, scratch_n=10):
    arr = scratches(arr, rng, scratch_n, 0.07)
    arr += grain(N, rng, 0.035)[:, :, None]
    return np.clip(arr, 0, 1)


def cell_manhole(rng):
    y, x = np.mgrid[0:N, 0:N]
    cx = cy = (N - 1) / 2
    r = np.hypot(x - cx, y - cy)
    ang = np.arctan2(y - cy, x - cx)
    iron = fbm(N, rng, 5, 6)
    arr = rgb((0.16, 0.15, 0.13), (iron - 0.5) * 0.22)
    disc = r < N * 0.46
    arr[disc] = rgb((0.28, 0.27, 0.25), (iron - 0.5) * 0.18)[disc]
    ring = (r > N * 0.40) & (r < N * 0.46)
    arr[ring] *= 0.72
    inner = (r > N * 0.33) & (r < N * 0.36)
    arr[inner] *= 0.78
    # radial pick holes
    slots = (np.abs(np.sin(ang * 8)) > 0.72) & (r > N * 0.12) & (r < N * 0.30)
    arr[slots] *= 0.22
    bolts = np.zeros_like(r, dtype=bool)
    for k in range(6):
        a = k * math.tau / 6
        bx = cx + math.cos(a) * N * 0.38
        by = cy + math.sin(a) * N * 0.38
        bolts |= np.hypot(x - bx, y - by) < N * 0.018
    arr[bolts] = (0.55, 0.52, 0.46)
    arr = stain(arr, rng, (0.32, 0.18, 0.10), 5, 0.45)
    arr[~disc] *= 0.35
    img = to_image(finish(arr, rng, 8))
    img = draw_mark(img, "HARBOR", (N * 0.22, N * 0.20), 42, (210, 196, 160, 210), wear=0.18)
    img = draw_mark(img, "QUAY", (N * 0.36, N * 0.46), 36, (186, 176, 150, 180), wear=0.28)
    return img


def cell_inlet(rng):
    concrete = fbm(N, rng, 5, 5)
    arr = rgb((0.34, 0.33, 0.31), (concrete - 0.5) * 0.16)
    # opening
    y, x = np.mgrid[0:N, 0:N]
    opening = (x > N * 0.12) & (x < N * 0.88) & (y > N * 0.18) & (y < N * 0.82)
    arr[opening] = (0.05, 0.05, 0.06)
    # vertical bars
    bars = opening & (((x / (N * 0.045)).astype(int) % 2) == 0) & (x > N * 0.16) & (x < N * 0.84)
    iron = fbm(N, rng, 4, 8)
    bar_col = rgb((0.22, 0.21, 0.19), (iron - 0.5) * 0.1)
    arr[bars] = bar_col[bars]
    # silt along the bottom lip
    silt = opening & (y > N * 0.68)
    m = np.clip((y - N * 0.68) / (N * 0.14), 0, 1)
    arr[:, :, 0] = np.where(silt, arr[:, :, 0] * (1 - m * 0.4) + 0.18 * m, arr[:, :, 0])
    arr[:, :, 1] = np.where(silt, arr[:, :, 1] * (1 - m * 0.45) + 0.14 * m, arr[:, :, 1])
    arr[:, :, 2] = np.where(silt, arr[:, :, 2] * (1 - m * 0.5) + 0.09 * m, arr[:, :, 2])
    arr = stain(arr, rng, (0.28, 0.16, 0.09), 3, 0.3)
    return to_image(finish(arr, rng, 6))


def cell_gutter(rng):
    iron = fbm(N, rng, 5, 7)
    arr = rgb((0.20, 0.19, 0.17), (iron - 0.5) * 0.14)
    y, x = np.mgrid[0:N, 0:N]
    frame = (x < N * 0.06) | (x > N * 0.94) | (y < N * 0.08) | (y > N * 0.92)
    arr[frame] = rgb((0.30, 0.28, 0.25), (iron - 0.5) * 0.08)[frame]
    slots = (y > N * 0.14) & (y < N * 0.86) & (((x / (N * 0.055)).astype(int) % 2) == 1)
    slots &= (x > N * 0.08) & (x < N * 0.92)
    arr[slots] *= 0.18
    # wet sheen down the middle
    sheen = np.exp(-((y - N * 0.48) / (N * 0.22)) ** 2)
    arr[:, :, 2] += sheen * 0.05
    arr = stain(arr, rng, (0.15, 0.18, 0.12), 3, 0.35)
    # one caught leaf, painted not a photo of a brand
    img = to_image(finish(np.clip(arr, 0, 1), rng, 5))
    draw = ImageDraw.Draw(img)
    draw.ellipse((N * 0.62, N * 0.22, N * 0.86, N * 0.40), fill=(48, 62, 38, 180))
    return img


def cell_throat(rng):
    n = fbm(N, rng, 5, 4)
    arr = rgb((0.07, 0.07, 0.08), (n - 0.5) * 0.08)
    y = np.linspace(0, 1, N, dtype=np.float32)[:, None]
    arr[:, :, 0] += y * 0.06
    arr[:, :, 1] += y * 0.045
    arr[:, :, 2] += y * 0.02
    arr = stain(arr, rng, (0.20, 0.12, 0.07), 6, 0.55)
    return to_image(finish(arr, rng, 4))


def cell_can(rng):
    """Dull zinc bin wall. Beads and hoops stay. Rust, salt, and dirt cover the whole wrap, heavier at the foot."""
    y, x = np.mgrid[0:N, 0:N]
    n = fbm(N, rng, 5, 8)
    grit = fbm(N, rng, 4, 14)
    # Night grade multiplies this. Stay under ~0.32 or the beads read as new galvanize.
    arr = rgb((0.24, 0.24, 0.22), (n - 0.5) * 0.08)
    period = N / 16.0
    phase = (x % period) / period
    groove = phase < 0.16
    arr[groove] *= 0.62
    bead = (phase >= 0.16) & (phase < 0.30)
    arr[bead] = np.minimum(0.34, arr[bead] + 0.035)
    for yc, thick in ((0.07, 0.028), (0.20, 0.016), (0.80, 0.018), (0.93, 0.032)):
        band = np.abs(y / N - yc) < thick
        arr[band] = arr[band] * 0.22 + np.array((0.22, 0.13, 0.08)) * 0.78
    grime = 0.22 + 0.55 * np.clip((y / N - 0.15) / 0.85, 0, 1)
    arr *= (1.0 - grime[..., None] * 0.45)
    rust_n = fbm(N, rng, 5, 5)
    low = np.clip(y / N, 0, 1)
    rust = (rust_n > 0.52) | ((np.abs(np.sin(x * 0.07 + rust_n * 4.0)) > 0.78) & (rust_n > 0.35))
    m = np.where(rust, 0.55 + 0.35 * low, 0.12 * low)
    rust_col = (0.34, 0.15, 0.07)
    for i, c in enumerate(rust_col):
        arr[:, :, i] = arr[:, :, i] * (1.0 - m) + c * m
    salt = grit > 0.70
    arr[salt] = arr[salt] * 0.55 + np.array((0.40, 0.38, 0.33)) * 0.45
    arr = stain(arr, rng, (0.12, 0.10, 0.08), 6, 0.48)
    arr = stain(arr, rng, (0.32, 0.14, 0.06), 4, 0.40)
    dent = np.exp(-(((x - N * 0.38) / 42.0) ** 2 + ((y - N * 0.42) / 36.0) ** 2))
    arr *= (1.0 - dent[:, :, None] * 0.32)
    arr = scratches(arr, rng, 22, 0.18)
    img = to_image(np.clip(arr + grain(N, rng, 0.025)[:, :, None], 0, 1))
    img = draw_mark(img, "QUAY", (N * 0.28, N * 0.22), 40, (28, 24, 20, 170), wear=0.42)
    return img


def cell_dumpster(rng):
    panel = fbm(N, rng, 5, 6)
    arr = rgb((0.20, 0.23, 0.18), (panel - 0.5) * 0.12)
    y, x = np.mgrid[0:N, 0:N]
    ribs = (np.abs(np.sin(y / N * math.pi * 10)) > 0.82)
    arr[ribs] *= 0.78
    # a broad dent
    dent = np.exp(-(((x - N * 0.62) / (N * 0.16)) ** 2 + ((y - N * 0.44) / (N * 0.10)) ** 2))
    arr += dent[:, :, None] * 0.08
    arr = stain(arr, rng, (0.28, 0.16, 0.08), 4, 0.4)
    img = to_image(finish(arr, rng, 8))
    img = draw_mark(img, "HARBOR", (N * 0.08, N * 0.40), 64, (226, 214, 180, 210), wear=0.16)
    return img


def cell_lid(rng):
    """Spun lid, dulled. Dirt sits in the rings; rust and salt sit on the lip."""
    y, x = np.mgrid[0:N, 0:N]
    cx = cy = (N - 1) / 2.0
    r = np.hypot(x - cx, y - cy)
    n = fbm(N, rng, 4, 8)
    arr = rgb((0.22, 0.22, 0.20), (n - 0.5) * 0.06)
    rings = np.sin(r * 0.42) > 0.15
    arr[rings] *= 0.62
    arr[r > N * 0.40] *= 0.55
    arr[r < N * 0.07] *= 0.7
    rust = (n > 0.68) & (r > N * 0.28)
    arr[rust] = arr[rust] * 0.4 + np.array((0.38, 0.17, 0.08)) * 0.6
    salt = (n < 0.22) & (r > N * 0.16) & (r < N * 0.42)
    arr[salt] = arr[salt] * 0.5 + np.array((0.48, 0.46, 0.40)) * 0.5
    arr = stain(arr, rng, (0.18, 0.14, 0.10), 4, 0.36)
    arr = scratches(arr, rng, 12, 0.12)
    img = to_image(np.clip(arr + grain(N, rng, 0.03)[:, :, None], 0, 1))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((N * 0.30, N * 0.455, N * 0.70, N * 0.545), radius=10, fill=(48, 42, 36, 255))
    draw.ellipse((N * 0.26, N * 0.42, N * 0.36, N * 0.58), fill=(28, 24, 20, 255))
    draw.ellipse((N * 0.64, N * 0.42, N * 0.74, N * 0.58), fill=(28, 24, 20, 255))
    return img


def cell_cardboard(rng):
    n = fbm(N, rng, 5, 8)
    arr = rgb((0.45, 0.36, 0.26), (n - 0.5) * 0.10)
    y, x = np.mgrid[0:N, 0:N]
    flute = 0.03 * np.sin(y / 3.2)
    arr[:, :, 0] += flute
    arr[:, :, 1] += flute * 0.8
    crease = np.abs(x - N * 0.5) < 2.2
    arr[crease] *= 0.72
    tape = (y > N * 0.18) & (y < N * 0.30)
    arr[tape] = arr[tape] * 0.55 + np.array((0.62, 0.52, 0.28)) * 0.45
    arr = stain(arr, rng, (0.22, 0.16, 0.10), 3, 0.35)
    img = to_image(finish(arr, rng, 6))
    img = draw_mark(img, "FENESTRA", (N * 0.08, N * 0.55), 48, (70, 52, 36, 220), wear=0.12)
    return img


def cell_bag(rng):
    n = fbm(N, rng, 6, 5)
    warp = fbm(N, rng, 4, 3)
    arr = rgb((0.07, 0.075, 0.08), (n - 0.5) * 0.05)
    y, x = np.mgrid[0:N, 0:N]
    # sharp plastic folds
    fold = np.abs(np.sin(x * 0.05 + warp * 8 + y * 0.01))
    highlight = np.clip(fold - 0.82, 0, 1) * 6.0
    arr += highlight[:, :, None] * 0.45
    arr = np.clip(arr, 0, 1)
    arr = stain(arr, rng, (0.12, 0.10, 0.08), 2, 0.2)
    return to_image(finish(arr, rng, 14))


def cell_litter(rng):
    paper = fbm(N, rng, 4, 6)
    arr = rgb((0.72, 0.68, 0.58), (paper - 0.5) * 0.08)
    y, x = np.mgrid[0:N, 0:N]
    # torn edge
    tear = x > (N * 0.08 + 18 * np.sin(y / 17.0))
    tear &= x < (N * 0.94 + 10 * np.sin(y / 23.0))
    tear &= y > N * 0.06
    tear &= y < N * 0.92
    arr[~tear] *= 0.15
    # abstract columns — not a real masthead
    cols = (x % 46) < 28
    cols &= (y > N * 0.22) & (y < N * 0.88) & tear
    cols &= ((y / 7).astype(int) % 3) != 0
    arr[cols] *= 0.55
    rule = (y > N * 0.16) & (y < N * 0.19) & tear
    arr[rule] = (0.55, 0.42, 0.16)
    # coffee ring
    cx, cy, rad = N * 0.68, N * 0.62, N * 0.12
    ring = np.abs(np.hypot(x - cx, y - cy) - rad) < 3.5
    arr[ring] = arr[ring] * 0.6 + np.array((0.28, 0.16, 0.08)) * 0.4
    img = to_image(finish(np.clip(arr, 0, 1), rng, 4))
    img = draw_mark(img, "FENESTRA", (N * 0.16, N * 0.04), 28, (40, 36, 30, 200), wear=0.15)
    return img


def cell_timber(rng):
    n = fbm(N, rng, 5, 4)
    arr = rgb((0.34, 0.27, 0.20), (n - 0.5) * 0.12)
    y, x = np.mgrid[0:N, 0:N]
    grain_line = 0.04 * np.sin(y * 0.35 + n * 6)
    arr[:, :, 0] += grain_line
    arr[:, :, 1] += grain_line * 0.7
    # board gaps
    gap = (y % (N // 4)) < 5
    arr[gap] *= 0.35
    # nail heads
    for by in (N * 0.12, N * 0.37, N * 0.62, N * 0.87):
        for bx in (N * 0.18, N * 0.82):
            nail = np.hypot(x - bx, y - by) < 5
            arr[nail] = (0.15, 0.14, 0.13)
    arr = stain(arr, rng, (0.25, 0.22, 0.18), 3, 0.25)
    return to_image(finish(np.clip(arr, 0, 1), rng, 7))


def cell_iron(rng):
    n = fbm(N, rng, 5, 6)
    arr = rgb((0.18, 0.17, 0.16), (n - 0.5) * 0.16)
    y, x = np.mgrid[0:N, 0:N]
    pitted = n < 0.32
    arr[pitted] *= 0.7
    for bx, by in ((0.2, 0.2), (0.8, 0.2), (0.2, 0.8), (0.8, 0.8), (0.5, 0.5)):
        bolt = np.hypot(x - bx * N, y - by * N) < N * 0.035
        arr[bolt] = (0.40, 0.38, 0.34)
    arr = stain(arr, rng, (0.30, 0.16, 0.08), 5, 0.4)
    return to_image(finish(arr, rng, 9))


def cell_soil(rng):
    n = fbm(N, rng, 6, 8)
    arr = rgb((0.12, 0.09, 0.07), (n - 0.5) * 0.10)
    y, x = np.mgrid[0:N, 0:N]
    pebbles = n > 0.78
    arr[pebbles] = rgb((0.28, 0.26, 0.22), 0)[pebbles]
    # twigs
    twig = (np.abs((y - N * 0.4) - 0.4 * (x - N * 0.2)) < 1.4) & (x > N * 0.15) & (x < N * 0.7)
    arr[twig] = (0.20, 0.14, 0.09)
    arr = stain(arr, rng, (0.08, 0.10, 0.06), 3, 0.3)
    return to_image(finish(arr, rng, 4))


def cell_concrete(rng):
    n = fbm(N, rng, 5, 5)
    arr = rgb((0.40, 0.39, 0.37), (n - 0.5) * 0.10)
    y, x = np.mgrid[0:N, 0:N]
    # board form lines
    boards = (x % 64) < 2
    arr[boards] *= 0.82
    pores = n > 0.86
    arr[pores] *= 0.55
    crack = np.abs((y - N * 0.2) - 0.55 * (x - N * 0.1)) < 1.1
    crack &= (x > N * 0.15) & (x < N * 0.8)
    arr[crack] *= 0.45
    # moss in a corner
    moss = (x > N * 0.72) & (y > N * 0.70)
    m = np.clip((x - N * 0.72) / (N * 0.2), 0, 1) * np.clip((y - N * 0.70) / (N * 0.22), 0, 1)
    arr[:, :, 0] = np.where(moss, arr[:, :, 0] * (1 - m * 0.45) + 0.16 * m, arr[:, :, 0])
    arr[:, :, 1] = np.where(moss, arr[:, :, 1] * (1 - m * 0.2) + 0.24 * m, arr[:, :, 1])
    arr[:, :, 2] = np.where(moss, arr[:, :, 2] * (1 - m * 0.45) + 0.12 * m, arr[:, :, 2])
    return to_image(finish(np.clip(arr, 0, 1), rng, 5))


def cell_weeds(rng):
    """Cutout clump. Alpha is the plant; the RGB is night green."""
    alpha = np.zeros((N, N), np.float32)
    color = np.zeros((N, N, 3), np.float32)
    y, x = np.mgrid[0:N, 0:N]
    # blades from the bottom
    for i in range(46):
        bx = rng.uniform(0.08, 0.92) * N
        lean = rng.uniform(-0.35, 0.35)
        width = rng.uniform(1.4, 3.2)
        height = rng.uniform(0.35, 0.92) * N
        base = N * rng.uniform(0.72, 0.98)
        t = (base - y) / height
        spine = bx + lean * (base - y)
        blade = (t > 0) & (t < 1) & (np.abs(x - spine) < width * (0.35 + 0.65 * t))
        shade = 0.22 + 0.35 * rng.random()
        g = shade * rng.uniform(0.9, 1.25)
        alpha[blade] = np.maximum(alpha[blade], np.clip(t[blade] * 1.2, 0, 1))
        color[blade, 0] = shade * 0.45
        color[blade, 1] = g
        color[blade, 2] = shade * 0.32
    # a few broad dock leaves
    for i in range(7):
        cx = rng.uniform(0.2, 0.8) * N
        cy = rng.uniform(0.25, 0.7) * N
        rx = rng.uniform(18, 40)
        ry = rng.uniform(10, 22)
        ang = rng.uniform(0, math.pi)
        dx = x - cx
        dy = y - cy
        xr = dx * math.cos(ang) + dy * math.sin(ang)
        yr = -dx * math.sin(ang) + dy * math.cos(ang)
        leaf = (xr / rx) ** 2 + (yr / ry) ** 2 < 1
        vein = np.abs(xr) < 1.2
        alpha[leaf] = np.maximum(alpha[leaf], 0.92)
        color[leaf] = (0.16, 0.28, 0.14)
        color[leaf & vein] = (0.10, 0.16, 0.08)
    alpha = np.clip(alpha, 0, 1)
    # soft edge
    a_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    alpha = np.array(a_img).astype(np.float32) / 255.0
    color += grain(N, rng, 0.03)[:, :, None]
    return to_image(np.clip(color, 0, 1), alpha)


def cell_hydrant(rng):
    """Faded quay red. Chips open onto iron; rust and salt do the rest. Collar is tarnished brass."""
    y, x = np.mgrid[0:N, 0:N]
    n = fbm(N, rng, 5, 6)
    grit = fbm(N, rng, 4, 11)
    # Faded, chalky, and broken on the upper barrel too. The night grade lifts facing surfaces.
    arr = rgb((0.28, 0.11, 0.08), (n - 0.5) * 0.05)
    chalk = grit > 0.48
    arr[chalk] = arr[chalk] * 0.62 + np.array((0.26, 0.18, 0.13)) * 0.38
    chip = n < 0.38
    arr[chip] = (0.12, 0.11, 0.10)
    rust_n = fbm(N, rng, 4, 5)
    rust = (rust_n > 0.48) | (chip & (rust_n > 0.30))
    arr[rust] = arr[rust] * 0.28 + np.array((0.30, 0.13, 0.06)) * 0.72
    streak = np.abs(np.sin(x * 0.07 + n * 2.4)) > 0.90
    arr[streak] = arr[streak] * 0.55 + np.array((0.36, 0.32, 0.26)) * 0.45
    scratch = (np.abs(np.sin(x * 0.08 + y * 0.012)) > 0.988)
    arr[scratch] = (0.15, 0.12, 0.10)
    band = (y > N * 0.40) & (y < N * 0.57)
    arr[band] = (0.24, 0.17, 0.09)
    patina = band & (grit > 0.64)
    arr[patina] = (0.20, 0.24, 0.14)
    arr[band & chip] = (0.15, 0.12, 0.09)
    edge = (np.abs(y - N * 0.40) < 4) | (np.abs(y - N * 0.57) < 4)
    arr[edge] *= 0.42
    bolts = (np.abs(y - N * 0.68) < N * 0.018) & (((x / 64).astype(int) % 2) == 0) & (x > 40) & (x < N - 40)
    bolts &= ((x % 64) < 16)
    arr[bolts] = (0.28, 0.24, 0.18)
    arr[bolts & (rust_n > 0.6)] = (0.32, 0.16, 0.08)
    arr = stain(arr, rng, (0.14, 0.11, 0.08), 4, 0.30)
    arr = scratches(arr, rng, 16, 0.16)
    img = to_image(np.clip(arr + grain(N, rng, 0.028)[:, :, None], 0, 1))
    img = draw_mark(img, "SIGNAL", (N * 0.14, N * 0.43), 42, (36, 24, 12, 210), wear=0.34)
    return img


CELLS = [
    [cell_manhole, cell_can, cell_bag, cell_soil],
    [cell_inlet, cell_dumpster, cell_litter, cell_concrete],
    [cell_gutter, cell_lid, cell_timber, cell_weeds],
    [cell_throat, cell_cardboard, cell_iron, cell_hydrant],
]


def main():
    sheet = Image.new("RGBA", (SHEET, SHEET), (8, 8, 10, 255))
    for row, row_fns in enumerate(CELLS):
        for col, fn in enumerate(row_fns):
            rng = np.random.default_rng(0xA71A5 + row * 17 + col * 53)
            cell = fn(rng)
            sheet.paste(cell, (col * N, row * N))
    out = os.path.join(ROOT, "street-clutter-atlas.png")
    sheet.save(out, "PNG", optimize=True)
    print(out, sheet.size, os.path.getsize(out))


if __name__ == "__main__":
    main()
