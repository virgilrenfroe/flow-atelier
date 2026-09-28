#!/usr/bin/env python3
"""Original night-basin fish skins for Harbor surface schools.

fish-atlas.png — four top-down species, stacked as UV rows (flipY, row 0
at the bottom). The only lettering is HARBOR, in the right margin the mesh
does not sample. No other words.
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image

W, H = 2048, 1024
ROWS = 4
ROOT = os.path.dirname(os.path.abspath(__file__))
ROW_H = H // ROWS


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def fade_mask(r, edge=0.08):
    return smooth(np.clip((1.0 - r) / edge, 0.0, 1.0))


# 5x7 bitmaps. Only the craft word HARBOR.
GLYPH = {
    "H": (
        "H...H",
        "H...H",
        "HHHHH",
        "H...H",
        "H...H",
        "H...H",
        "H...H",
    ),
    "A": (
        ".HHH.",
        "H...H",
        "H...H",
        "HHHHH",
        "H...H",
        "H...H",
        "H...H",
    ),
    "R": (
        "HHHH.",
        "H...H",
        "H...H",
        "HHHH.",
        "H.H..",
        "H..H.",
        "H...H",
    ),
    "B": (
        "HHHH.",
        "H...H",
        "H...H",
        "HHHH.",
        "H...H",
        "H...H",
        "HHHH.",
    ),
    "O": (
        ".HHH.",
        "H...H",
        "H...H",
        "H...H",
        "H...H",
        "H...H",
        ".HHH.",
    ),
}


def stamp_word(img, word, x, y, scale, color):
    h, w, _ = img.shape
    for i, ch in enumerate(word):
        glyph = GLYPH[ch]
        ox = x + i * (6 * scale)
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit != "H":
                    continue
                y0 = y + gy * scale
                x0 = ox + gx * scale
                y1 = min(h, y0 + scale)
                x1 = min(w, x0 + scale)
                if y0 >= h or x0 >= w:
                    continue
                img[y0:y1, x0:x1] = color


def paint_species(rng, kind):
    """One top-down skin. v=0 tail (bottom of this array), v=1 nose."""
    yy, xx = np.mgrid[0:ROW_H, 0:W].astype(np.float32)
    u = xx / (W - 1)
    v = 1.0 - (yy / (ROW_H - 1))

    if kind == 0:
        back = np.array([28, 40, 52], np.float32)
        flank = np.array([168, 184, 196], np.float32)
        belly = np.array([214, 214, 206], np.float32)
        fin = np.array([46, 62, 74], np.float32)
        accent = np.array([186, 198, 210], np.float32)
    elif kind == 1:
        back = np.array([32, 40, 28], np.float32)
        flank = np.array([112, 122, 86], np.float32)
        belly = np.array([196, 190, 160], np.float32)
        fin = np.array([28, 36, 24], np.float32)
        accent = np.array([168, 154, 96], np.float32)
    elif kind == 2:
        back = np.array([18, 32, 44], np.float32)
        flank = np.array([72, 108, 128], np.float32)
        belly = np.array([198, 206, 204], np.float32)
        fin = np.array([16, 28, 36], np.float32)
        accent = np.array([210, 214, 208], np.float32)
    else:
        back = np.array([62, 36, 24], np.float32)
        flank = np.array([148, 96, 62], np.float32)
        belly = np.array([214, 186, 150], np.float32)
        fin = np.array([48, 28, 20], np.float32)
        accent = np.array([196, 150, 96], np.float32)

    water = back * 0.35 + np.array([8, 12, 16], np.float32)

    du = (u - 0.46) / 0.22
    dv = (v - 0.50) / 0.34
    body_r = np.sqrt(du * du + dv * dv)
    body = fade_mask(body_r, 0.10)

    # Caudal fork, left of the peduncle.
    tail_v = (v - 0.16) / 0.12
    tail_u = (u - 0.46) / 0.16
    tail = fade_mask(np.sqrt(tail_u * tail_u + np.maximum(tail_v, 0.0) ** 2), 0.35)
    fork = np.exp(-((u - 0.46) ** 2) / 0.004) * smooth(np.clip((0.22 - v) / 0.08, 0.0, 1.0))
    tail = np.clip(tail * (1.0 - fork * 0.85), 0.0, 1.0)

    pec_l = np.exp(-((u - 0.24) ** 2) / 0.0045 - ((v - 0.46) ** 2) / 0.012)
    pec_r = np.exp(-((u - 0.68) ** 2) / 0.0045 - ((v - 0.46) ** 2) / 0.012)
    pec = np.clip(pec_l + pec_r, 0.0, 1.0)

    spine = np.exp(-((u - 0.46) ** 2) / 0.012)
    flank_k = smooth(np.clip(np.abs(u - 0.46) / 0.20, 0.0, 1.0))
    base = back * (1.0 - flank_k)[:, :, None] + flank * flank_k[:, :, None]
    base = base * (1.0 - 0.35 * spine[:, :, None]) + belly * (flank_k * 0.35)[:, :, None]

    # Scale arcs. Period follows the body so the photo reads as skin, not noise.
    along = v * 86.0 + np.sin(u * 30.0) * 1.4
    across = u * 64.0
    scale = 0.5 + 0.5 * np.sin(along) * np.sin(across)
    scale = smooth(scale)
    hi = accent * (0.15 + 0.22 * scale)[:, :, None]
    base = np.clip(base + hi * body[:, :, None], 0.0, 255.0)

    if kind == 2:
        bars = 0.5 + 0.5 * np.sin(v * 46.0)
        bars = smooth(np.clip((bars - 0.62) / 0.28, 0.0, 1.0))
        base = base * (1.0 - 0.42 * bars * body)[:, :, None]

    # Lateral line, a wet catch along the flank.
    line = np.exp(-((u - 0.58) ** 2) / 0.0009) * body
    base = base + accent * (0.22 * line)[:, :, None]

    # Gill crescent and eye on the shoulder.
    gill = np.exp(-((v - 0.70) ** 2) / 0.0012) * np.exp(-((u - 0.46) ** 2) / 0.02)
    base = base * (1.0 - 0.45 * gill)[:, :, None]
    eye = np.exp(-((u - 0.46) ** 2) / 0.0011 - ((v - 0.80) ** 2) / 0.004)
    catch = np.exp(-((u - 0.475) ** 2) / 0.00025 - ((v - 0.815) ** 2) / 0.001)
    base = base * (1.0 - 0.85 * eye)[:, :, None] + np.array([232, 236, 240], np.float32) * catch[:, :, None]

    fin_col = fin
    covered = np.clip(body + tail * 0.95 + pec * 0.8, 0.0, 1.0)
    rgb = water * (1.0 - covered)[:, :, None]
    rgb = rgb + base * body[:, :, None]
    rgb = rgb + fin_col * (tail * (1.0 - body) + pec * (1.0 - body * 0.5))[:, :, None]

    grain = rng.standard_normal((ROW_H, W)).astype(np.float32)
    grain = grain * (1.6 + 2.4 * covered)
    rgb = rgb + grain[:, :, None]

    # Soft vignette so the row edge does not sparkle.
    edge = smooth(np.clip(u / 0.04, 0.0, 1.0)) * smooth(np.clip((1.0 - u) / 0.04, 0.0, 1.0))
    edge = edge * smooth(np.clip(v / 0.03, 0.0, 1.0)) * smooth(np.clip((1.0 - v) / 0.03, 0.0, 1.0))
    rgb = rgb * (0.55 + 0.45 * edge)[:, :, None]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def main():
    rng = np.random.default_rng(27)
    img = np.zeros((H, W, 3), np.uint8)
    # UV row 0 is the bottom of the file (texture flipY).
    for kind in range(ROWS):
        skin = paint_species(rng, kind)
        y0 = H - (kind + 1) * ROW_H
        img[y0:y0 + ROW_H] = skin

    # Margin the mesh clamps away from (u > ~0.93). One craft word only.
    stamp_word(img, "HARBOR", 1888, 470, 4, np.array([232, 220, 196], np.uint8))
    out = os.path.join(ROOT, "fish-atlas.png")
    Image.fromarray(img, "RGB").save(out, optimize=True)
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    main()
