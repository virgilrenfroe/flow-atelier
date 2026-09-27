#!/usr/bin/env python3
"""Original wet-night quay deck atlases.

Procedural, tileable, no stock photos and no trademarks.
Writes albedo / normal / roughness sheets for the hero promenade:

  06-intermediate-assets/quay-deck-atlas.png
  06-intermediate-assets/quay-deck-normal.png
  06-intermediate-assets/quay-deck-rough.png

Albedo is sRGB. Normal is OpenGL (Y-up in UV, flat = 128,128,255).
Roughness is linear in every channel; the shader reads G, matching
Three.js roughnessMap convention.
"""

from pathlib import Path

import numpy as np
from PIL import Image

W, H = 2048, 1024
N_PLANKS = 8
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "06-intermediate-assets"


def lin_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def fade(t):
    return t * t * (3.0 - 2.0 * t)


def periodic_noise(h, w, cells_y, cells_x, rng):
    """Value noise that tiles. cells_* are the lattice periods."""
    gy = int(cells_y)
    gx = int(cells_x)
    lattice = rng.random((gy, gx), dtype=np.float32)
    y = np.arange(h, dtype=np.float32) * (gy / h)
    x = np.arange(w, dtype=np.float32) * (gx / w)
    y0 = np.floor(y).astype(np.int32) % gy
    x0 = np.floor(x).astype(np.int32) % gx
    y1 = (y0 + 1) % gy
    x1 = (x0 + 1) % gx
    fy = fade(y - np.floor(y))[:, None]
    fx = fade(x - np.floor(x))[None, :]
    n00 = lattice[y0][:, x0]
    n10 = lattice[y0][:, x1]
    n01 = lattice[y1][:, x0]
    n11 = lattice[y1][:, x1]
    return (n00 * (1.0 - fx) + n10 * fx) * (1.0 - fy) + (n01 * (1.0 - fx) + n11 * fx) * fy


def fbm(h, w, cells_y, cells_x, rng, octaves=4, seed_salt=0):
    acc = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    total = 0.0
    cy, cx = cells_y, cells_x
    for i in range(octaves):
        child = np.random.default_rng(rng.integers(0, 2**31) + seed_salt + i * 17)
        acc += amp * periodic_noise(h, w, max(2, cy), max(2, cx), child)
        total += amp
        amp *= 0.5
        cy = min(cy * 2, h // 2)
        cx = min(cx * 2, w // 2)
    return acc / total


def normals_from_height(height, strength):
    """OpenGL normal, assuming image row 0 is +V after Three.js flipY."""
    d_u = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    # V increases toward row 0 (top). dH/dV = H[higher V] - H[lower V].
    d_v = (np.roll(height, 1, axis=0) - np.roll(height, -1, axis=0)) * 0.5
    nx = -d_u * strength
    ny = -d_v * strength
    nz = np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return nx / ln, ny / ln, nz / ln


def paint_star_screw(height, albedo, rough, recess_mask, rim_mask, cy, cx, radius, rotation):
    """Countersunk 6-lobe (star-bit) recess. One connected hexalobe, not a slot, cross, or hex."""
    r = int(np.ceil(radius * 1.45)) + 2
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1].astype(np.float32)
    dist = np.sqrt(yy * yy + xx * xx)
    ang = np.arctan2(yy, xx) + rotation
    # ISO-style hexalobe: r = a + b cos(6θ). Waist is pinched so six lobes read.
    lobe = np.cos(6.0 * ang)
    recess_r = radius * (0.56 + 0.36 * lobe)
    head = dist <= radius
    recess = dist <= recess_r
    rim = head & (dist >= radius * 0.72) & ~recess
    bevel = (dist > radius) & (dist <= radius * 1.34)
    ys = np.mod(cy + yy.astype(np.int32), height.shape[0])
    xs = np.mod(cx + xx.astype(np.int32), height.shape[1])

    h = height[ys, xs]
    dome = np.clip(1.0 - dist / max(radius, 1.0), 0.0, 1.0)
    h = np.where(head, np.maximum(h, 0.62) * 0.55 + 0.28 + dome * 0.08, h)
    depth = np.clip((recess_r - dist) / (radius * 0.42), 0.0, 1.0)
    h = np.where(recess, 0.34 - depth * 0.28, h)
    bev = np.clip((radius * 1.34 - dist) / (radius * 0.34), 0.0, 1.0)
    h = np.where(bevel, h * (0.62 + 0.38 * bev), h)
    height[ys, xs] = h

    metal = np.array([0.24, 0.255, 0.285], dtype=np.float32)
    recess_col = np.array([0.010, 0.012, 0.018], dtype=np.float32)
    rim_col = np.array([0.36, 0.385, 0.42], dtype=np.float32)
    albedo[ys[head], xs[head]] = metal
    albedo[ys[rim], xs[rim]] = rim_col
    albedo[ys[recess], xs[recess]] = recess_col
    rough[ys[head], xs[head]] = 0.18
    rough[ys[rim], xs[rim]] = 0.10
    rough[ys[recess], xs[recess]] = 0.72
    recess_mask[ys[recess], xs[recess]] = True
    rim_mask[ys[rim], xs[rim]] = True


def stamp_disk(field, cy, cx, radius, profile):
    """Add profile(dist) into field, wrapping Y and X so the tile stays periodic."""
    r = int(np.ceil(radius)) + 1
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
    dist = np.sqrt(yy * yy + xx * xx).astype(np.float32)
    mask = dist <= radius + 0.5
    if not np.any(mask):
        return
    add = profile(dist) * mask
    h, w = field.shape[:2]
    ys = (cy + yy) % h
    xs = (cx + xx) % w
    if field.ndim == 2:
        field[ys, xs] += add
    else:
        field[ys, xs] += add[..., None]


def main():
    rng = np.random.default_rng(20260927)

    # Uneven timber widths that still sum to the sheet (wrap seam is shared).
    raw = np.array([0.92, 1.10, 0.86, 1.16, 0.98, 1.06, 0.84, 1.08], dtype=np.float64)
    widths = raw / raw.sum() * W
    edges = np.zeros(N_PLANKS + 1, dtype=np.int32)
    edges[1:] = np.cumsum(np.round(widths)).astype(np.int32)
    edges[-1] = W

    # Cool night-dock boards. Linear light, slightly lifted so ACES night
    # still shows grain. Neighbors differ enough to survive minification.
    palette = np.array(
        [
            [0.145, 0.162, 0.198],
            [0.112, 0.132, 0.168],
            [0.158, 0.170, 0.196],
            [0.098, 0.124, 0.158],
            [0.132, 0.148, 0.176],
            [0.118, 0.138, 0.172],
            [0.164, 0.176, 0.204],
            [0.104, 0.122, 0.152],
        ],
        dtype=np.float32,
    )

    height = np.zeros((H, W), dtype=np.float32)
    albedo = np.zeros((H, W, 3), dtype=np.float32)
    rough = np.full((H, W), 0.46, dtype=np.float32)

    # Broad mineral + salt, periodic so the sheet tiles.
    mineral = fbm(H, W, 6, 10, rng, octaves=4)
    fine = fbm(H, W, 40, 70, rng, octaves=3)
    grit_n = fbm(H, W, 90, 140, rng, octaves=2)
    stain = fbm(H, W, 3, 5, rng, octaves=3)

    x_all = np.arange(W, dtype=np.float32)
    seam_dist = np.full(W, 1.0e6, dtype=np.float32)
    for s in edges[:-1]:
        d = np.abs(x_all - s)
        d = np.minimum(d, W - d)
        seam_dist = np.minimum(seam_dist, d)

    for i in range(N_PLANKS):
        a, b = int(edges[i]), int(edges[i + 1])
        span = max(b - a, 1)
        u = (np.arange(span, dtype=np.float32) + 0.5) / span
        # Crowned board: edges drop into the joint.
        crown = np.sin(np.clip(u, 0.0, 1.0) * np.pi) ** 0.72
        crown = 0.22 + 0.78 * crown
        # Slight twist along the length so boards are not extrusions.
        y = np.linspace(0.0, 1.0, H, endpoint=False, dtype=np.float32)
        twist = 0.04 * np.sin(2.0 * np.pi * (y * (1.0 + (i % 3)) + i * 0.17))
        board_h = crown[None, :] + twist[:, None] * (u[None, :] - 0.5)

        # Anisotropic fiber: many cycles across the board, few along it, Y-periodic.
        fiber_rng = np.random.default_rng(4100 + i * 97)
        fiber = periodic_noise(H, span, 18 + (i % 5), 3, fiber_rng)
        fiber += 0.55 * periodic_noise(H, span, 46, 6, np.random.default_rng(8200 + i))
        fiber += 0.28 * periodic_noise(H, span, 90, 10, np.random.default_rng(12000 + i))
        fiber /= 1.83
        # A few darker growth rings / resin lines along the board.
        ring = 0.5 + 0.5 * np.sin(u * np.pi * (7.0 + (i % 4)) + fiber.mean(axis=0) * 3.0)
        ring = ring[None, :]

        base = palette[i % len(palette)]
        # Neighbor boards already differ; add a slow along-length drift.
        drift = 0.92 + 0.16 * fiber
        col = base[None, None, :] * drift[..., None]
        col *= 0.86 + 0.22 * ring[..., None]
        # Cross-grain chatter, faint, periodic in V.
        chatter = 0.5 + 0.5 * np.sin(y * np.pi * 2.0 * (11 + i % 7))
        col *= (0.94 + 0.06 * chatter)[:, None, None]

        height[:, a:b] = board_h * (0.82 + 0.18 * fiber) 
        albedo[:, a:b] = col
        # Traffic polish sits on the crown, not in the joint.
        rough[:, a:b] = 0.40 + 0.16 * (1.0 - crown[None, :]) + 0.08 * (1.0 - fiber)

    # Soft joint shadow (survives a mip) plus a tight tar gap (close read).
    soft = np.clip(1.0 - seam_dist / 22.0, 0.0, 1.0) ** 1.35
    gap = np.clip(1.0 - seam_dist / 5.5, 0.0, 1.0) ** 1.1
    lip = np.clip(1.0 - np.abs(seam_dist - 8.0) / 3.5, 0.0, 1.0) ** 1.4

    height *= 1.0 - 0.72 * soft[None, :]
    height = np.clip(height, 0.0, 1.0)
    height += lip[None, :] * 0.16
    height *= 1.0 - 0.85 * gap[None, :]
    # Joint profile is a function of distance only, so the shared wrap seam
    # matches on both edges (fiber on either board must not kink the normal).
    seam_h = (np.clip(seam_dist / 12.0, 0.0, 1.0) ** 1.35) * 0.58 + lip * 0.14
    blend = np.clip((16.0 - seam_dist) / 8.0, 0.0, 1.0)
    height = height * (1.0 - blend[None, :]) + seam_h[None, :] * blend[None, :]

    albedo *= (1.0 - 0.62 * soft)[None, :, None]
    albedo *= (1.0 - 0.78 * gap)[None, :, None]
    albedo += lip[None, :, None] * np.array([0.035, 0.042, 0.055], dtype=np.float32)
    # Tar in the gap — cooler than the board, not a mirror.
    albedo = np.where(
        gap[None, :, None] > 0.65,
        np.array([0.018, 0.022, 0.030], dtype=np.float32),
        albedo,
    )

    rough = np.clip(rough + soft[None, :] * 0.28 + gap[None, :] * 0.35 - lip[None, :] * 0.12, 0.12, 0.96)

    # Mineral grit and salt. Sparse bright specks, not a full-frame hash.
    albedo *= 0.90 + 0.16 * mineral[..., None]
    albedo += (fine[..., None] - 0.5) * np.array([0.012, 0.014, 0.018], dtype=np.float32)
    speck = np.clip((grit_n - 0.78) / 0.22, 0.0, 1.0) ** 2
    albedo += speck[..., None] * np.array([0.11, 0.125, 0.145], dtype=np.float32)
    height += (mineral - 0.5) * 0.05 + speck * 0.08
    rough = np.clip(rough + (fine - 0.5) * 0.08 + speck * 0.22, 0.08, 0.98)

    # Cool damp stains in the grain — static, irregular, not round puddles.
    damp = np.clip((0.46 - stain) * 1.8, 0.0, 1.0) * np.clip(mineral, 0.0, 1.0)
    albedo *= 1.0 - damp[..., None] * np.array([0.22, 0.16, 0.08], dtype=np.float32)
    rough = np.clip(rough - damp * 0.10, 0.08, 0.98)
    height -= damp * 0.03

    # Short splits, one or two per board, away from the tile edge.
    for i in range(N_PLANKS):
        a, b = int(edges[i]), int(edges[i + 1])
        span = b - a
        split_rng = np.random.default_rng(900 + i)
        for k in range(1 + (i % 2)):
            cy = int((0.22 + 0.18 * k + split_rng.random() * 0.15) * H)
            length = int(span * (0.18 + 0.12 * split_rng.random()))
            x0 = a + int(span * (0.18 + 0.1 * k))
            x1 = min(b - 6, x0 + length)
            yy = np.arange(-1, 2)
            for dx in range(x0, x1):
                wobble = int(np.round(np.sin((dx - x0) * 0.35 + i) * 1.2))
                ys = (cy + wobble + yy) % H
                height[ys, dx] *= 0.55
                albedo[ys, dx] *= 0.45
                rough[ys, dx] = np.maximum(rough[ys, dx], 0.72)

    # Fine grit in the height, periodic so it tiles. Kept off the tar gap.
    height += ((fine - 0.5) * 0.045 + (grit_n - 0.5) * 0.02) * (1.0 - gap[None, :])
    height = np.clip(height, 0.0, 1.2)

    # Star-bit screws after grit and splits so the 6-lobe recess stays crisp.
    # Inset from joints; staggered so the repeat is not a grid.
    recess_mask = np.zeros((H, W), dtype=bool)
    rim_mask = np.zeros((H, W), dtype=bool)
    screw_radius = 22.0
    for i in range(N_PLANKS):
        a, b = int(edges[i]), int(edges[i + 1])
        span = b - a
        inset = max(int(screw_radius * 1.5), int(span * 0.22))
        cols = (a + inset, b - inset)
        phase = (0.07 * i) % 0.16
        stations = (0.14 + phase, 0.38 + phase * 0.5, 0.63 - phase * 0.25, 0.86 - phase)
        for si, v in enumerate(stations):
            cy = int(v * H) % H
            cx = int(cols[si % 2])
            paint_star_screw(
                height, albedo, rough, recess_mask, rim_mask,
                cy, cx, screw_radius, rotation=0.31 * i + 0.17 * si,
            )

    # Bake a cool key into the albedo so seams read even before the spec term.
    nx, ny, nz = normals_from_height(height, strength=5.5)
    ndl = np.clip(nx * 0.42 + ny * 0.22 + nz * 0.88, 0.0, 1.0)
    albedo *= (0.78 + 0.40 * ndl)[..., None]
    # Hemispheric cool fill, so groove bottoms are not crushed to black.
    albedo += nz[..., None] * np.array([0.012, 0.016, 0.024], dtype=np.float32)
    albedo = np.clip(albedo, 0.0, 0.42)
    # Re-assert the star after the bake so lobe floors stay darker than the head.
    albedo[recess_mask] = np.array([0.012, 0.015, 0.022], dtype=np.float32)
    albedo[rim_mask] = np.maximum(albedo[rim_mask], np.array([0.30, 0.325, 0.36], dtype=np.float32))

    # Recompute normals after the albedo bake used the same height.
    nx, ny, nz = normals_from_height(height, strength=6.0)
    normal = np.stack((nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5), axis=-1)
    normal = np.clip(normal, 0.0, 1.0)

    rough = np.clip(rough, 0.08, 0.98)
    rough_rgb = np.stack((rough, rough, rough), axis=-1)

    OUT.mkdir(parents=True, exist_ok=True)

    def save(name, arr, srgb=False):
        img = lin_to_srgb(arr) if srgb else arr
        u8 = np.clip(np.round(img * 255.0), 0, 255).astype(np.uint8)
        path = OUT / name
        Image.fromarray(u8, mode="RGB").save(path, format="PNG", optimize=True)
        print(f"{path.name} {path.stat().st_size} bytes {u8.shape}")

    save("quay-deck-atlas.png", albedo, srgb=True)
    save("quay-deck-normal.png", normal, srgb=False)
    save("quay-deck-rough.png", rough_rgb, srgb=False)

    prev = np.clip(np.round(lin_to_srgb(albedo) * 255.0), 0, 255).astype(np.uint8)
    small = np.array(Image.fromarray(prev, mode="RGB").resize((512, 256), Image.Resampling.BOX))
    tiled = np.tile(small, (2, 2, 1))
    preview = Path("/tmp/quay-deck-preview.png")
    Image.fromarray(tiled, mode="RGB").save(preview, format="PNG")
    print("preview", preview)


if __name__ == "__main__":
    main()
