#!/usr/bin/env python3
"""Original Harbor boat atlases for the modern basin fleet.

Three 2048² sheets, each a 4×4 grid of 512px cells. Row 0 is the top of the
PNG so it matches harborCellUV (v = 1 at the top of a cell).

Cells, column then row:
  (0,0) hull gelcoat     (1,0) tube or rub rail   (2,0) trim      (3,0) transom
  (0,1) deck nonskid     (1,1) seat vinyl         (2,1) console   (3,1) roof
  (0,2) glazing          (1,2) brushed aluminum   (2,2) cowl      (3,2) rubber
  (0,3) HARBOR           (1,3) SIGNAL             (2,3) QUAY      (3,3) FENESTRA

Hull, deck, console, roof, and transom stay near-white so a gelcoat tint can
multiply them. Tube, vinyl, glass, metal, cowl, rubber, and name boards are
baked. The only lettering is HARBOR, SIGNAL, QUAY, and FENESTRA.

No brand marks, liveries, or logos. Cues are functional (boot stripe, rub
strake, nonskid, bonded screen, raked-glass reflection), not a copied paint job.
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
CELL = 512
SIZE = CELL * 4
WORDS = ("HARBOR", "SIGNAL", "QUAY", "FENESTRA")

# 5×7 stencil. Only the letters those four words need.
GLYPH = {
    "H": ("H...H", "H...H", "HHHHH", "H...H", "H...H", "H...H", "H...H"),
    "A": (".HHH.", "H...H", "H...H", "HHHHH", "H...H", "H...H", "H...H"),
    "R": ("HHHH.", "H...H", "H...H", "HHHH.", "H.H..", "H..H.", "H...H"),
    "B": ("HHHH.", "H...H", "H...H", "HHHH.", "H...H", "H...H", "HHHH."),
    "O": (".HHH.", "H...H", "H...H", "H...H", "H...H", "H...H", ".HHH."),
    "S": (".HHHH", "H....", "H....", ".HHH.", "....H", "....H", "HHHH."),
    "I": ("HHHHH", "..H..", "..H..", "..H..", "..H..", "..H..", "HHHHH"),
    "G": (".HHHH", "H....", "H....", "H.HHH", "H...H", "H...H", ".HHHH"),
    "N": ("H...H", "HH..H", "H.H.H", "H.H.H", "H..HH", "H...H", "H...H"),
    "L": ("H....", "H....", "H....", "H....", "H....", "H....", "HHHHH"),
    "Q": (".HHH.", "H...H", "H...H", "H...H", "H.H.H", "H..H.", ".HH.H"),
    "U": ("H...H", "H...H", "H...H", "H...H", "H...H", "H...H", ".HHH."),
    "Y": ("H...H", "H...H", ".H.H.", "..H..", "..H..", "..H..", "..H.."),
    "F": ("HHHHH", "H....", "H....", "HHHH.", "H....", "H....", "H...."),
    "E": ("HHHHH", "H....", "H....", "HHHH.", "H....", "H....", "HHHHH"),
    "T": ("HHHHH", "..H..", "..H..", "..H..", "..H..", "..H..", "..H.."),
}


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def grids():
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    u = xx.astype(np.float32) / (CELL - 1)
    v = 1.0 - yy.astype(np.float32) / (CELL - 1)
    return u, v


def noise(seed, blur):
    rng = np.random.default_rng(seed)
    n = rng.random((CELL, CELL), dtype=np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8), mode="L")
    im = im.filter(ImageFilter.GaussianBlur(radius=blur))
    return np.asarray(im).astype(np.float32) / 255.0 - 0.5


def seam_band(coord, centers, width):
    acc = np.zeros_like(coord)
    for c in centers:
        acc += np.exp(-((coord - c) ** 2) / width)
    return np.clip(acc, 0.0, 1.0)


def stamp_word(albedo, height, col, row, word, color):
    """Centered stencil. Glyph row 0 is the top of the letter."""
    y0 = row * CELL
    x0 = col * CELL
    sx = 10 if len(word) >= 8 else 13
    sy = 34 if len(word) >= 8 else 42
    width = len(word) * 6 * sx - sx
    ox = x0 + (CELL - width) // 2
    oy = y0 + (CELL - 7 * sy) // 2 - 18
    ink = np.array(color, np.float32)
    for i, ch in enumerate(word):
        glyph = GLYPH[ch]
        for gy, line in enumerate(glyph):
            for gx, bit in enumerate(line):
                if bit != "H":
                    continue
                xa = ox + i * 6 * sx + gx * sx
                ya = oy + gy * sy
                albedo[ya : ya + sy - 1, xa : xa + sx - 1] = ink
                height[ya : ya + sy - 1, xa : xa + sx - 1] -= 0.28
    # Registration-like ticks under the word. Blocks, not a copied number.
    tick_y = oy + 7 * sy + 16
    tick_colors = np.array([196, 176, 146], np.float32)
    span = width
    n = 5
    gap = span // (n * 2)
    tx = ox
    for i in range(n):
        tw = gap + (i % 3) * 4
        albedo[tick_y : tick_y + 8, tx : tx + tw] = tick_colors
        height[tick_y : tick_y + 8, tx : tx + tw] -= 0.12
        tx += tw + gap


def paint_hull(albedo, height, rough, emit, u, v, spec):
    base = np.array(spec["hull"], np.float32)
    peel = noise(spec["seed"], 1.4)
    blot = noise(spec["seed"] + 3, 7.0)
    rgb = base + peel[:, :, None] * 7.0 + blot[:, :, None] * 5.0
    h = peel * 0.035 + blot * 0.02
    # Boot stripe at the keel (low v). A single hairline above it is a
    # waterline, not a hull graphic.
    boot = smooth(np.clip((spec["boot_h"] - v) / 0.018, 0.0, 1.0))
    boot_rgb = np.array(spec["boot"], np.float32)
    rgb = rgb * (1.0 - boot[:, :, None]) + boot_rgb * boot[:, :, None]
    h -= boot * 0.04
    line = np.exp(-((v - (spec["boot_h"] + 0.02)) ** 2) / 1.6e-5)
    stripe = np.array(spec["stripe"], np.float32)
    rgb = rgb * (1.0 - line[:, :, None] * 0.85) + stripe * (line[:, :, None] * 0.85)
    h -= line * 0.05
    rub = smooth(np.clip((v - 0.93) / 0.035, 0.0, 1.0))
    rub_rgb = np.array(spec["rub"], np.float32)
    rgb = rgb * (1.0 - rub[:, :, None]) + rub_rgb * rub[:, :, None]
    h += rub * 0.06
    if spec["seams"] == "vertical":
        grooves = seam_band(u, (0.0, 0.5, 1.0), 2.2e-5)
    else:
        grooves = seam_band(v, spec["strakes"], 1.4e-5)
    rgb *= 1.0 - grooves[:, :, None] * 0.07
    h -= grooves * 0.11
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = h
    r = spec["hull_rough"] + boot * 0.18 + rub * 0.22 + np.abs(peel) * 0.05
    rough[:] = np.clip(r, 0.0, 1.0)
    glow = 0.78 - boot * 0.55 - rub * 0.35
    emit[:] = np.clip(rgb / 255.0 * glow[:, :, None], 0, 1)


def paint_tube(albedo, height, rough, emit, u, v, spec):
    if spec["tube"] == "hypalon":
        base = np.array([58, 62, 68], np.float32)
        mott = noise(spec["seed"] + 11, 3.0)
        rgb = base + mott[:, :, None] * 16.0
        h = mott * 0.04
        baffles = seam_band(u, (0.0, 0.25, 0.5, 0.75, 1.0), 3.5e-5)
        rgb *= 1.0 - baffles[:, :, None] * 0.22
        h -= baffles * 0.16
        strake = smooth(np.clip((0.08 - np.abs(v - 0.62)) / 0.08, 0.0, 1.0))
        pale = np.array([214, 206, 190], np.float32)
        rgb = rgb * (1.0 - strake[:, :, None]) + pale * strake[:, :, None]
        h += strake * 0.14
        groove = np.exp(-((v - 0.48) ** 2) / 1.2e-4)
        dashes = smooth(np.clip(np.sin(u * np.pi * 18.0) * 0.5 + 0.5, 0, 1))
        grab = groove * dashes
        rgb *= 1.0 - grab[:, :, None] * 0.45
        h -= grab * 0.12
        rough[:] = np.clip(0.72 + mott * 0.08 - strake * 0.18, 0, 1)
    else:
        # Extruded rub rail: dark body, pale insert. Not an inflatable collar.
        base = np.array([48, 46, 44], np.float32)
        rgb = np.broadcast_to(base, (CELL, CELL, 3)).copy()
        h = np.zeros((CELL, CELL), np.float32)
        body = smooth(np.clip((0.22 - np.abs(v - 0.5)) / 0.22, 0.0, 1.0))
        rgb *= 0.55 + body[:, :, None] * 0.45
        h += body * 0.12
        insert = np.exp(-((v - 0.5) ** 2) / 1.8e-4)
        pale = np.array(spec["stripe"], np.float32)
        rgb = rgb * (1.0 - insert[:, :, None] * 0.9) + pale * (insert[:, :, None] * 0.9)
        h += insert * 0.08
        rough[:] = np.clip(0.78 - insert * 0.2, 0, 1)
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = h
    emit[:] = np.clip(rgb / 255.0 * 0.28, 0, 1)


def paint_trim(albedo, height, rough, emit, u, v, spec):
    paint_tube(albedo, height, rough, emit, u, v, {**spec, "tube": "rail"})


def paint_transom(albedo, height, rough, emit, u, v, spec):
    paint_hull(albedo, height, rough, emit, u, v, {**spec, "seams": "vertical", "strakes": ()})
    # Blank plate recess. The readable word sits on the name-board row.
    plate = smooth(np.clip((0.16 - np.abs(u - 0.5)) / 0.04, 0, 1)) * smooth(
        np.clip((0.08 - np.abs(v - 0.72)) / 0.03, 0, 1)
    )
    dark = np.array([36, 32, 28], np.float32)
    albedo[:] = albedo * (1.0 - plate[:, :, None]) + dark * plate[:, :, None]
    height[:] -= plate * 0.08
    rough[:] = np.clip(rough * (1.0 - plate) + plate * 0.48, 0, 1)


def paint_deck(albedo, height, rough, emit, u, v, spec):
    base = np.array(spec["deck"], np.float32)
    rgb = np.broadcast_to(base, (CELL, CELL, 3)).astype(np.float32).copy()
    n = spec["deck_n"]
    fu = (u * n) % 1.0
    fv = (v * n) % 1.0
    if spec["deck_mode"] == "diamond":
        peak = np.clip(1.0 - (np.abs(fu - 0.5) + np.abs(fv - 0.5)) * 2.15, 0.0, 1.0)
        peak = smooth(peak)
    else:
        r = np.sqrt((fu - 0.5) ** 2 + (fv - 0.5) ** 2)
        peak = smooth(np.clip(1.0 - r / 0.22, 0.0, 1.0))
    ink = np.array(spec["deck_ink"], np.float32)
    rgb = rgb * (1.0 - peak[:, :, None] * 0.28) + ink * (peak[:, :, None] * 0.28)
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = peak * 0.16
    rough[:] = np.clip(0.9 - peak * 0.08, 0, 1)
    emit[:] = np.clip(rgb / 255.0 * 0.42, 0, 1)


def paint_seat(albedo, height, rough, emit, u, v, spec):
    base = np.array(spec["vinyl"], np.float32)
    grain = noise(spec["seed"] + 21, 1.2)
    rgb = base + grain[:, :, None] * 10.0
    welt = seam_band(v, (0.08, 0.92), 8e-5) + seam_band(u, (0.06, 0.94), 8e-5)
    stitch = seam_band(v, (0.16, 0.84), 2.4e-5)
    dark = base * 0.55
    rgb = rgb * (1.0 - welt[:, :, None] * 0.35) + dark * (welt[:, :, None] * 0.35)
    rgb *= 1.0 - stitch[:, :, None] * 0.25
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = grain * 0.03 + welt * 0.05 - stitch * 0.06
    rough[:] = np.clip(0.58 + np.abs(grain) * 0.08, 0, 1)
    emit[:] = np.clip(rgb / 255.0 * 0.34, 0, 1)


def paint_console(albedo, height, rough, emit, u, v, spec):
    base = np.array(spec["hull"], np.float32)
    rgb = np.broadcast_to(base, (CELL, CELL, 3)).astype(np.float32).copy()
    h = noise(spec["seed"] + 5, 2.0) * 0.02
    bezel_u = smooth(np.clip((0.14 - np.abs(u - 0.5)) / 0.05 + 0.55, 0, 1))
    bezel_v = smooth(np.clip((0.16 - np.abs(v - spec["screen_v"])) / 0.05 + 0.55, 0, 1))
    screen = bezel_u * bezel_v
    glass = np.array([28, 26, 24], np.float32)
    rgb = rgb * (1.0 - screen[:, :, None]) + glass * screen[:, :, None]
    h -= screen * 0.1
    slash = np.exp(-((u * 0.55 + (v - spec["screen_v"]) - 0.05) ** 2) / 0.004) * screen
    rgb = rgb + slash[:, :, None] * np.array([90, 70, 48], np.float32)
    belt = seam_band(v, (0.22,), 6e-5)
    rgb *= 1.0 - belt[:, :, None] * 0.08
    h -= belt * 0.05
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = h
    rough[:] = np.clip(0.42 - screen * 0.28, 0.08, 1)
    glow = 0.62 + screen * 0.2 + slash * 0.5
    emit[:] = np.clip((rgb / 255.0) * glow[:, :, None] + slash[:, :, None] * 0.35, 0, 1)


def paint_roof(albedo, height, rough, emit, u, v, spec):
    base = np.array(spec["roof"], np.float32)
    rgb = np.broadcast_to(base, (CELL, CELL, 3)).astype(np.float32).copy()
    edge = np.maximum(
        smooth(np.clip((0.06 - np.minimum(u, 1 - u)) / 0.03, 0, 1)),
        smooth(np.clip((0.06 - np.minimum(v, 1 - v)) / 0.03, 0, 1)),
    )
    lip = np.array(spec["rub"], np.float32)
    rgb = rgb * (1.0 - edge[:, :, None] * 0.65) + lip * (edge[:, :, None] * 0.65)
    center = seam_band(u, (0.5,), 2e-5)
    rgb *= 1.0 - center[:, :, None] * 0.06
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = edge * 0.1 - center * 0.07
    rough[:] = np.clip(0.4 + edge * 0.25, 0, 1)
    emit[:] = np.clip(rgb / 255.0 * 0.5, 0, 1)


def paint_glass(albedo, height, rough, emit, u, v, spec):
    base = np.array(spec["glass"], np.float32)
    rgb = np.broadcast_to(base, (CELL, CELL, 3)).astype(np.float32).copy()
    slash = np.exp(-((u * spec["glass_k"] + v - spec["glass_b"]) ** 2) / 0.012)
    warm = np.array([214, 156, 96], np.float32)
    rgb = rgb * (1.0 - slash[:, :, None] * 0.75) + warm * (slash[:, :, None] * 0.75)
    fall = 0.75 + 0.25 * v
    rgb *= fall[:, :, None]
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = slash * 0.04
    rough[:] = np.clip(0.1 + (1.0 - slash) * 0.06, 0, 1)
    emit[:] = np.clip(0.55 + slash[:, :, None] * 0.45, 0, 1)
    emit[:] *= np.array([1.0, 0.72, 0.42], np.float32)


def paint_metal(albedo, height, rough, emit, u, v, spec):
    base = np.array([196, 202, 206], np.float32)
    brush = 0.5 + 0.5 * np.sin(v * np.pi * 220.0)
    grain = noise(spec["seed"] + 40, 0.6)
    rgb = base + (brush[:, :, None] - 0.5) * 10.0 + grain[:, :, None] * 6.0
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = (brush - 0.5) * 0.025 + grain * 0.015
    rough[:] = np.clip(0.3 + (1.0 - brush) * 0.08, 0, 1)
    emit[:] = np.clip(rgb / 255.0 * 0.36, 0, 1)


def paint_cowl(albedo, height, rough, emit, u, v, spec):
    base = np.array([40, 44, 48], np.float32)
    rgb = np.broadcast_to(base, (CELL, CELL, 3)).astype(np.float32).copy()
    split = seam_band(u, (0.5,), 3e-5)
    vents = np.zeros_like(u)
    for i in range(5):
        vents += np.exp(-((v - (0.58 + i * 0.045)) ** 2) / 8e-6) * smooth(
            np.clip((0.22 - np.abs(u - 0.5)) / 0.06, 0, 1)
        )
    vents = np.clip(vents, 0, 1)
    rgb *= 1.0 - np.clip(split + vents, 0, 1)[:, :, None] * 0.35
    rgb += vents[:, :, None] * np.array([18, 16, 14], np.float32)
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = -split * 0.08 - vents * 0.1
    rough[:] = np.clip(0.46 + vents * 0.1, 0, 1)
    emit[:] = np.clip(rgb / 255.0 * 0.3 + vents[:, :, None] * 0.08, 0, 1)


def paint_rubber(albedo, height, rough, emit, u, v, spec):
    base = np.array([52, 48, 44], np.float32)
    ribs = 0.5 + 0.5 * np.sin(v * np.pi * 36.0)
    rgb = base * (0.82 + ribs[:, :, None] * 0.18)
    albedo[:] = np.clip(rgb, 0, 255)
    height[:] = (ribs - 0.5) * 0.08
    rough[:] = np.clip(0.8 - ribs * 0.06, 0, 1)
    emit[:] = np.clip(rgb / 255.0 * 0.22, 0, 1)


def paint_mark(albedo, height, rough, emit, word):
    plate = np.array([42, 36, 32], np.float32)
    albedo[:] = plate
    height[:] = 0.0
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    m = 28
    border = (xx < m) | (xx >= CELL - m) | (yy < m) | (yy >= CELL - m)
    inner = (xx < m + 6) | (xx >= CELL - m - 6) | (yy < m + 6) | (yy >= CELL - m - 6)
    line = inner & ~border
    albedo[line] = np.array([168, 142, 108], np.float32)
    height[line] = 0.06
    # stamp_word indexes the full sheet; this helper fills a cell view.
    # Caller stamps after the cell is copied, so leave the field clear here.
    rough[:] = 0.52
    emit[:] = 0.16
    return word


def normals_from_height(h, strength):
    dx = np.zeros_like(h)
    dy = np.zeros_like(h)
    dx[:, 1:-1] = h[:, 2:] - h[:, :-2]
    dy[1:-1, :] = h[:-2, :] - h[2:, :]
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack(
        (nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5),
        axis=-1,
    )
    return np.clip(rgb, 0.0, 1.0)


SPECS = {
    "rib": {
        "seed": 17,
        "hull": (236, 234, 228),
        "boot": (34, 36, 40),
        "boot_h": 0.24,
        "stripe": (176, 124, 68),
        "rub": (54, 52, 48),
        "seams": "vertical",
        "strakes": (),
        "hull_rough": 0.36,
        "tube": "hypalon",
        "deck": (226, 224, 218),
        "deck_ink": (168, 164, 154),
        "deck_mode": "diamond",
        "deck_n": 16,
        "vinyl": (74, 68, 62),
        "screen_v": 0.58,
        "roof": (214, 212, 206),
        "glass": (36, 30, 26),
        "glass_k": 0.35,
        "glass_b": 0.72,
    },
    "tender": {
        "seed": 29,
        "hull": (240, 234, 224),
        "boot": (38, 40, 44),
        "boot_h": 0.16,
        "stripe": (150, 118, 78),
        "rub": (62, 56, 50),
        "seams": "strake",
        "strakes": (0.4, 0.58),
        "hull_rough": 0.34,
        "tube": "rail",
        "deck": (232, 226, 214),
        "deck_ink": (176, 164, 142),
        "deck_mode": "dot",
        "deck_n": 22,
        "vinyl": (168, 144, 116),
        "screen_v": 0.52,
        "roof": (220, 214, 202),
        "glass": (42, 34, 28),
        "glass_k": 0.85,
        "glass_b": 1.05,
    },
    "cabin": {
        "seed": 41,
        "hull": (232, 228, 220),
        "boot": (32, 34, 38),
        "boot_h": 0.2,
        "stripe": (164, 132, 86),
        "rub": (58, 54, 48),
        "seams": "vertical",
        "strakes": (),
        "hull_rough": 0.33,
        "tube": "rail",
        "deck": (224, 220, 210),
        "deck_ink": (150, 144, 132),
        "deck_mode": "diamond",
        "deck_n": 12,
        "vinyl": (148, 134, 118),
        "screen_v": 0.48,
        "roof": (210, 206, 198),
        "glass": (32, 26, 22),
        "glass_k": 1.15,
        "glass_b": 1.25,
    },
}


def build(kind):
    spec = SPECS[kind]
    albedo = np.zeros((SIZE, SIZE, 3), np.float32)
    height = np.zeros((SIZE, SIZE), np.float32)
    rough = np.ones((SIZE, SIZE), np.float32) * 0.5
    emit = np.zeros((SIZE, SIZE, 3), np.float32)
    u, v = grids()
    painters = [
        (0, 0, paint_hull),
        (1, 0, paint_tube),
        (2, 0, paint_trim),
        (3, 0, paint_transom),
        (0, 1, paint_deck),
        (1, 1, paint_seat),
        (2, 1, paint_console),
        (3, 1, paint_roof),
        (0, 2, paint_glass),
        (1, 2, paint_metal),
        (2, 2, paint_cowl),
        (3, 2, paint_rubber),
    ]
    for col, row, fn in painters:
        y0 = row * CELL
        x0 = col * CELL
        sl = (slice(y0, y0 + CELL), slice(x0, x0 + CELL))
        ca = np.zeros((CELL, CELL, 3), np.float32)
        ch = np.zeros((CELL, CELL), np.float32)
        cr = np.zeros((CELL, CELL), np.float32)
        ce = np.zeros((CELL, CELL, 3), np.float32)
        fn(ca, ch, cr, ce, u, v, spec)
        albedo[sl] = ca
        height[sl] = ch
        rough[sl] = cr
        emit[sl] = ce
    for col, word in enumerate(WORDS):
        y0 = 3 * CELL
        x0 = col * CELL
        sl = (slice(y0, y0 + CELL), slice(x0, x0 + CELL))
        albedo[sl] = np.array([42, 36, 32], np.float32)
        height[sl] = 0.0
        rough[sl] = 0.52
        emit[sl] = 0.18
        stamp_word(albedo, height, col, 3, word, (236, 220, 196))
        # Brighten the recessed letters in the emissive sheet.
        cell_h = height[sl]
        letters = cell_h < -0.05
        emit[sl][letters] = (0.95, 0.82, 0.62)
        rough[sl][letters] = 0.38
    normal = normals_from_height(height, 5.5)
    return albedo, normal, rough, emit


def save_rgb(path, arr, float_unit=False):
    if float_unit:
        rgb = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
    else:
        rgb = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(rgb, mode="RGB").save(path, optimize=True)
    print(path, rgb.shape)


def main():
    for kind, stem in (
        ("rib", "modern-rib"),
        ("tender", "modern-tender"),
        ("cabin", "modern-cabin"),
    ):
        albedo, normal, rough, emit = build(kind)
        save_rgb(os.path.join(ROOT, stem + "-atlas.png"), albedo)
        save_rgb(os.path.join(ROOT, stem + "-normal.png"), normal, float_unit=True)
        rough_rgb = np.repeat(rough[:, :, None], 3, axis=2)
        save_rgb(os.path.join(ROOT, stem + "-rough.png"), rough_rgb, float_unit=True)
        save_rgb(os.path.join(ROOT, stem + "-emissive.png"), emit, float_unit=True)
        # Hull mid-band should stay a gelcoat, not a plank field.
        y0, y1 = 80, 300
        x0, x1 = 40, 470
        patch = albedo[y0:y1, x0:x1]
        std = float(patch.std())
        print(f"{kind} hull patch std {std:.2f}")
        if std > 14:
            raise SystemExit(f"{kind} hull reads too busy ({std:.1f})")


if __name__ == "__main__":
    main()
