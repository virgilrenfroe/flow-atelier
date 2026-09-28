#!/usr/bin/env python3
"""A01 · Quay bay bake — headless Blender (Cycles).

Authors a one-room Harbor shop interior (quay fenestra), bakes a lighting-only
lightmap (diffuse direct + indirect, albedo excluded) and an AO map, then
exports GLB with two UV sets.

  blender --background --python 07-advanced/a01-bake/bake_quay_bay.py

Blender Z-up, depth along +Y (interior). glTF export is Y-up:
opening plane z = 0, interior extends toward -Z, floor at y = 0.

Technique only — no Journey / Portal product marks.
"""
from __future__ import annotations

import array
import json
import math
import os
import struct
import sys
import zlib

import bpy
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "07-advanced-assets", "a01-bake")

# Room metres. Keep in quay-bay.json — Harbor hook and the drill read it.
# Opening numbers are the fenestra fit. Do not change them when adding clutter.
W, D, H = 2.40, 2.10, 2.24
T = 0.08
OPEN_L, OPEN_R = -0.73, 0.73
SILL, HEAD = 0.42, 1.96
NICHE_Y0, NICHE_Y1, NICHE_Z1 = 0.38, 1.22, 1.30
NICHE_X_BACK = -1.58  # recess behind the left inner face (-W/2)

SAMPLES = int(os.environ.get("A01_SAMPLES", "64"))
RES = int(os.environ.get("A01_RES", "2048"))
TEX = 512
PREVIEW = os.environ.get("A01_PREVIEW") == "1"


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.use_denoising = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    try:
        scene.cycles.use_fast_gi = False
    except Exception:
        pass

    world = bpy.data.worlds.new("NightInk")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Night ink surround — enough for a faint bounce, not a flat fill.
    bg.inputs[0].default_value = (0.012, 0.014, 0.022, 1.0)
    bg.inputs[1].default_value = 0.22
    return scene


def make_mat(name, color, rough=0.82, metal=0.0, emit=None, emit_strength=0.0, specular=0.35):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Specular IOR Level"].default_value = specular
    if emit is not None and emit_strength > 0:
        bsdf.inputs["Emission Color"].default_value = (emit[0], emit[1], emit[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return mat


def _noise(u, v, seed, tile=True):
    """Fast Perlin. Tiled variant wraps so a 1 m repeat has no seam."""
    if tile:
        a = u * math.tau
        b = v * math.tau
        p = mathutils.Vector((
            math.cos(a) * 1.7,
            math.sin(a) * 1.7,
            math.cos(b) * 1.3 + seed,
        ))
    else:
        p = mathutils.Vector((u, v, seed))
    return mathutils.noise.noise(p)


def _fbm(u, v, seed, octaves=4, tile=True):
    s = 0.0
    a = 0.5
    f = 1.0
    w = 0.0
    for o in range(octaves):
        s += a * _noise(u * f, v * f, seed + o * 3.17, tile=tile)
        w += a
        a *= 0.5
        f *= 2.0
    return s / w


def _smooth(edge0, edge1, x):
    if edge0 == edge1:
        return 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def _buf():
    return array.array("f", [0.0]) * (TEX * TEX * 4)


def _put(buf, x, y, r, g, b):
    o = (y * TEX + x) * 4
    buf[o] = r
    buf[o + 1] = g
    buf[o + 2] = b
    buf[o + 3] = 1.0


def _normals(height, strength, tile_u=True, tile_v=True):
    buf = _buf()
    n = TEX

    def h(x, y):
        if tile_u:
            x %= n
        else:
            x = 0 if x < 0 else (n - 1 if x >= n else x)
        if tile_v:
            y %= n
        else:
            y = 0 if y < 0 else (n - 1 if y >= n else y)
        return height[y * n + x]

    for y in range(n):
        for x in range(n):
            dx = (h(x + 1, y) - h(x - 1, y)) * strength
            dy = (h(x, y + 1) - h(x, y - 1)) * strength
            nx, ny, nz = -dx, -dy, 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            _put(buf, x, y, nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5)
    return buf


def _image(name, buf, colorspace):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False, float_buffer=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(buf)
    img.pack()
    return img


def _paint_floor():
    """1 m tile. Four boards across U, grain running along V. Night-stained."""
    alb = _buf()
    rough = _buf()
    height = [0.0] * (TEX * TEX)
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            plank = math.floor(u * 4.0)
            pu = (u * 4.0) % 1.0
            seam = _smooth(0.0, 0.035, pu) * _smooth(0.0, 0.035, 1.0 - pu)
            n = _fbm(u * 3.0, v * 3.0, 2.2) * 0.5 + 0.5
            # Grain lines run the length of the board (constant U).
            grain = 0.5 + 0.5 * math.sin((u * 4.0 * 9.0 + n * 2.0) * math.tau)
            knot = _fbm(u * 7.0, v * 5.0, 8.0) * 0.5 + 0.5
            tint = (math.sin(plank * 2.3) * 0.5 + 0.5)
            base = (0.09 + tint * 0.055, 0.06 + tint * 0.03, 0.038 + tint * 0.012)
            col = [base[i] * (0.62 + 0.55 * n) * (0.82 + 0.22 * grain) for i in range(3)]
            if knot > 0.74:
                k = (knot - 0.74) / 0.26
                col = [c * (1.0 - 0.5 * k) for c in col]
            col = [c * (0.22 + 0.78 * seam) for c in col]
            scuff = _fbm(u * 1.5, v * 14.0, 19.0, octaves=2) * 0.5 + 0.5
            if scuff > 0.66:
                s = (scuff - 0.66) / 0.34
                col = [min(1.0, c + 0.035 * s) for c in col]
            _put(alb, x, y, *col)
            rv = 0.74 - 0.18 * (1.0 - seam)
            rv *= 0.88 + 0.18 * (1.0 - n)
            if scuff > 0.66:
                rv *= 0.52
            rv = max(0.28, min(0.96, rv))
            _put(rough, x, y, rv, rv, rv)
            height[y * TEX + x] = seam * 0.55 + n * 0.25 + (0.15 if scuff > 0.66 else 0.0)
    return alb, rough, _normals(height, 6.0)


def _paint_plaster():
    """U tiles every metre. V is the full wall height — dirt sits at the floor."""
    alb = _buf()
    rough = _buf()
    height = [0.0] * (TEX * TEX)
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            n = _fbm(u * 4.0, v * 2.4, 4.4, tile=True) * 0.5 + 0.5
            speck = _noise(u * 40.0, v * 28.0, 1.7, tile=True) * 0.5 + 0.5
            dirt = _smooth(0.22, 0.0, v)
            stain = _fbm(u * 1.6, v * 0.8, 12.0, octaves=3) * 0.5 + 0.5
            drip = _smooth(0.62, 0.82, _fbm(u * 8.0, v * 1.4, 30.0, octaves=2) * 0.5 + 0.5)
            drip *= _smooth(0.08, 0.45, v)
            base = (0.100, 0.106, 0.124)
            col = [base[i] * (0.48 + 0.85 * n) for i in range(3)]
            col = [c * (1.0 - 0.62 * dirt) for c in col]
            col = [c * (1.0 - 0.40 * max(0.0, stain - 0.52) * 2.2) for c in col]
            col = [c * (1.0 - 0.16 * drip) for c in col]
            col = [min(1.0, max(0.0, c + (speck - 0.5) * 0.02)) for c in col]
            _put(alb, x, y, *col)
            rv = 0.84 + (n - 0.5) * 0.10 + dirt * 0.08
            if n > 0.70:
                rv -= 0.24 * (n - 0.70) / 0.30
            rv = max(0.42, min(0.98, rv))
            _put(rough, x, y, rv, rv, rv)
            height[y * TEX + x] = n * 0.35 + dirt * 0.4 + speck * 0.05
    return alb, rough, _normals(height, 3.5, tile_v=False)


def _paint_timber():
    alb = _buf()
    rough = _buf()
    height = [0.0] * (TEX * TEX)
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            n = _fbm(u * 2.0, v * 5.0, 6.5) * 0.5 + 0.5
            grain = 0.5 + 0.5 * math.sin((v * 22.0 + n * 3.0) * math.tau)
            ring = _fbm(u * 3.0, v * 3.0, 15.0, octaves=2) * 0.5 + 0.5
            base = (0.145, 0.088, 0.048)
            col = [base[i] * (0.75 + 0.35 * n) * (0.88 + 0.14 * grain) for i in range(3)]
            # Cup ring, off-center, reads as a worked counter.
            du, dv = u - 0.38, v - 0.62
            cup = math.sqrt(du * du + dv * dv)
            ring_m = _smooth(0.07, 0.045, abs(cup - 0.11))
            col = [c * (1.0 - 0.35 * ring_m) for c in col]
            if ring > 0.78:
                col = [c * 0.8 for c in col]
            _put(alb, x, y, *col)
            rv = 0.58 + (1.0 - grain) * 0.12 + ring_m * 0.15
            rv = max(0.32, min(0.9, rv))
            _put(rough, x, y, rv, rv, rv)
            height[y * TEX + x] = grain * 0.3 + n * 0.2 + ring_m * 0.25
    return alb, rough, _normals(height, 4.0)


def _paint_iron():
    alb = _buf()
    rough = _buf()
    height = [0.0] * (TEX * TEX)
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            n = _fbm(u * 6.0, v * 6.0, 3.3) * 0.5 + 0.5
            pit = _smooth(0.72, 0.88, n)
            base = (0.16, 0.165, 0.175)
            col = [base[i] * (0.70 + 0.35 * (1.0 - pit)) * (0.85 + 0.2 * n) for i in range(3)]
            _put(alb, x, y, *col)
            rv = 0.34 + pit * 0.45 + (n - 0.5) * 0.08
            rv = max(0.22, min(0.92, rv))
            _put(rough, x, y, rv, rv, rv)
            height[y * TEX + x] = (1.0 - pit) * 0.45 + n * 0.15
    return alb, rough, _normals(height, 5.0)


def _paint_rug():
    alb = _buf()
    rough = _buf()
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            weave = _fbm(u * 18.0, v * 18.0, 9.1, octaves=2) * 0.5 + 0.5
            stain = _fbm(u * 2.0, v * 2.0, 4.8) * 0.5 + 0.5
            du, dv = u - 0.5, v - 0.5
            center = max(0.0, 1.0 - math.sqrt(du * du + dv * dv) * 1.6)
            base = (0.075, 0.032, 0.028)
            border = _smooth(0.08, 0.0, min(u, v, 1.0 - u, 1.0 - v))
            stripe = 0.75 + 0.25 * (0.5 + 0.5 * math.sin(v * 7.0 * math.tau))
            col = [base[i] * (0.7 + 0.5 * weave) * (0.8 + 0.35 * stain) * stripe for i in range(3)]
            col = [c * (1.0 - 0.45 * border) for c in col]
            col = [min(1.0, c + 0.035 * center) for c in col]
            _put(alb, x, y, *col)
            rv = 0.92 - 0.18 * center
            _put(rough, x, y, rv, rv, rv)
    return alb, rough


def _paint_cloth():
    alb = _buf()
    rough = _buf()
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            weave = 0.5 + 0.5 * math.sin((u * 36.0) * math.tau) * math.sin((v * 36.0) * math.tau)
            n = _fbm(u * 3.0, v * 3.0, 21.0) * 0.5 + 0.5
            base = (0.055, 0.052, 0.064)
            col = [base[i] * (0.8 + 0.35 * weave) * (0.85 + 0.25 * n) for i in range(3)]
            _put(alb, x, y, *col)
            _put(rough, x, y, 0.86, 0.86, 0.86)
    return alb, rough


def _paint_paper():
    alb = _buf()
    rough = _buf()
    for y in range(TEX):
        v = y / TEX
        for x in range(TEX):
            u = x / TEX
            n = _fbm(u * 8.0, v * 3.0, 17.0, octaves=3) * 0.5 + 0.5
            fibre = _noise(u * 50.0, v * 20.0, 2.2) * 0.5 + 0.5
            base = (0.155, 0.125, 0.085)
            col = [base[i] * (0.82 + 0.28 * n) + (fibre - 0.5) * 0.015 for i in range(3)]
            _put(alb, x, y, *[max(0.0, min(1.0, c)) for c in col])
            _put(rough, x, y, 0.78, 0.78, 0.78)
    return alb, rough


def _scale_albedo(buf, gain):
    out = _buf()
    for i in range(0, len(buf), 4):
        out[i] = buf[i] * gain
        out[i + 1] = buf[i + 1] * gain
        out[i + 2] = buf[i + 2] * gain
        out[i + 3] = 1.0
    return out


def make_tex_mat(name, albedo, rough, normal=None, metal=0.0, specular=0.4):
    mat = make_mat(name, (1, 1, 1), metal=metal, specular=specular)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    uv.location = (-640, 0)

    def tex(img, loc):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.interpolation = "Smart"
        node.extension = "REPEAT"
        node.location = loc
        nt.links.new(uv.outputs["UV"], node.inputs["Vector"])
        return node

    c = tex(albedo, (-360, 180))
    nt.links.new(c.outputs["Color"], bsdf.inputs["Base Color"])
    r = tex(rough, (-360, -40))
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    if normal is not None:
        n = tex(normal, (-360, -280))
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.space = "TANGENT"
        nm.location = (-80, -280)
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def add_box(name, loc, dims, mat):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.dimensions = dims
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.append(mat)
    return ob


def add_cyl(name, loc, radius, depth, mat, verts=8):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=loc
    )
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    ob.data.materials.append(mat)
    return ob


def add_torus(name, loc, major, minor, mat):
    bpy.ops.mesh.primitive_torus_add(
        location=loc,
        rotation=(math.radians(90), 0.0, 0.0),
        major_radius=major,
        minor_radius=minor,
        major_segments=12,
        minor_segments=6,
    )
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    ob.data.materials.append(mat)
    return ob


def add_point(name, loc, color, energy, size=0.08):
    data = bpy.data.lights.new(name, "POINT")
    data.color = color
    data.energy = energy
    data.shadow_soft_size = size
    data.use_shadow = True
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    return ob


def add_area(name, loc, rot, color, energy, size_x, size_y):
    data = bpy.data.lights.new(name, "AREA")
    data.color = color
    data.energy = energy
    data.shape = "RECTANGLE"
    data.size = size_x
    data.size_y = size_y
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def furnish(timber, iron, rug, cloth, paper):
    """Lived-in shop clutter. Stays inside the room; opening metrics are untouched."""
    amber = make_mat("Amber", (0.16, 0.07, 0.03), rough=0.32, specular=0.55)
    green = make_mat("GreenWare", (0.045, 0.07, 0.05), rough=0.4, specular=0.48)
    cream = make_mat("CreamWare", (0.18, 0.16, 0.12), rough=0.5, specular=0.42)
    top = 0.9275

    add_box("Rug", (0.02, 0.78, 0.008), (0.92, 1.05, 0.012), rug)
    add_box("BaseBack", (0.05, D - 0.025, 0.045), (W - 0.2, 0.02, 0.09), timber)
    add_box("BaseRight", (W * 0.5 - 0.02, 1.05, 0.045), (0.02, 1.9, 0.09), timber)

    # Stool in the opening view, in front of the counter.
    add_box("StoolSeat", (-0.02, 0.92, 0.46), (0.34, 0.32, 0.04), timber)
    for i, (x, y) in enumerate(((-0.12, 0.82), (0.08, 0.82), (-0.12, 1.02), (0.08, 1.02))):
        add_box(f"StoolLeg{i}", (x, y, 0.22), (0.035, 0.035, 0.44), timber)
    add_box("StoolBack", (-0.02, 1.06, 0.66), (0.32, 0.03, 0.28), timber)

    add_box("FloorCrate", (-0.78, 0.55, 0.14), (0.32, 0.28, 0.28), timber)
    add_box("FloorCrateB", (0.62, 0.42, 0.11), (0.28, 0.24, 0.22), timber)
    add_box("Sack", (-0.48, 0.38, 0.07), (0.26, 0.20, 0.12), cloth)
    add_box("BootA", (0.42, 0.22, 0.035), (0.08, 0.18, 0.06), timber)
    add_box("BootB", (0.52, 0.24, 0.035), (0.08, 0.16, 0.06), timber)
    add_cyl("Bucket", (-0.98, 1.02, 0.11), 0.09, 0.20, iron, verts=10)
    add_torus("Rope", (-0.82, 1.05, 0.04), 0.07, 0.018, cloth)

    # Counter top — clear of the practical at (0.10, 1.38, 1.00).
    add_cyl("Mug", (-0.48, 1.52, top + 0.04), 0.038, 0.075, cream, verts=10)
    add_box("Ledger", (-0.72, 1.78, top + 0.012), (0.20, 0.14, 0.02), paper)
    add_box("Ledger2", (-0.70, 1.80, top + 0.03), (0.16, 0.11, 0.012), paper)
    add_cyl("CounterTin", (0.22, 1.62, top + 0.045), 0.04, 0.08, iron, verts=8)
    add_box("CounterCloth", (-0.18, 1.88, top + 0.012), (0.18, 0.12, 0.018), cloth)
    add_cyl("Bowl", (0.24, 1.82, top + 0.02), 0.07, 0.035, cream, verts=10)

    # Shelf: bottles, books, boxes. Board tops sit just above 0.46 / 0.96 / 1.46.
    ceramics = (amber, green, cream, amber)
    for i, y in enumerate((0.86, 1.04, 1.20, 1.36)):
        add_cyl(f"Bottle{i}", (1.00, y, 0.56), 0.028, 0.15, ceramics[i], verts=8)
    add_box("Books", (1.00, 0.90, 1.04), (0.14, 0.16, 0.10), paper)
    add_box("BookLean", (1.00, 1.08, 1.02), (0.10, 0.14, 0.07), timber)
    add_box("ShelfBox", (1.00, 1.28, 1.05), (0.15, 0.13, 0.12), timber)
    add_cyl("Jar", (1.00, 1.40, 1.04), 0.045, 0.10, green, verts=8)
    add_box("ShelfCrate", (1.00, 1.02, 1.56), (0.14, 0.16, 0.12), timber)
    add_box("ShelfBoxHigh", (1.00, 1.28, 1.54), (0.12, 0.12, 0.10), paper)

    # Back wall, in the opening's view.
    add_box("Frame", (-0.48, D - 0.03, 1.48), (0.42, 0.02, 0.52), frame_mat())
    add_box("FramePaper", (-0.48, D - 0.045, 1.48), (0.30, 0.012, 0.38), paper)
    add_box("Coat", (0.28, D - 0.04, 1.05), (0.26, 0.025, 0.62), cloth)
    add_cyl("CoatHook", (0.28, D - 0.03, 1.40), 0.015, 0.04, iron, verts=6)
    add_box("Ledge", (-0.05, D - 0.08, 0.78), (0.55, 0.12, 0.02), timber)
    add_cyl("LedgeTinA", (-0.18, D - 0.10, 0.84), 0.035, 0.08, iron, verts=8)
    add_cyl("LedgeTinB", (0.05, D - 0.10, 0.86), 0.03, 0.11, amber, verts=8)


def frame_mat():
    # Shared dark frame. Created once.
    existing = bpy.data.materials.get("Frame")
    if existing:
        return existing
    return make_mat("Frame", (0.03, 0.032, 0.04), rough=0.55, metal=0.15, specular=0.35)


def build_surfaces():
    """Night-range albedo. Grit and wear live in the textures, not a brighter base."""
    print("A01 painting surfaces", flush=True)
    f_alb, f_rgh, f_nrm = _paint_floor()
    p_alb, p_rgh, p_nrm = _paint_plaster()
    t_alb, t_rgh, t_nrm = _paint_timber()
    i_alb, i_rgh, i_nrm = _paint_iron()
    r_alb, r_rgh = _paint_rug()
    c_alb, c_rgh = _paint_cloth()
    a_alb, a_rgh = _paint_paper()
    floor = _image("FloorAlb", f_alb, "sRGB")
    floor_r = _image("FloorRgh", f_rgh, "Non-Color")
    floor_n = _image("FloorNrm", f_nrm, "Non-Color")
    plaster = _image("PlasterAlb", p_alb, "sRGB")
    plaster_r = _image("PlasterRgh", p_rgh, "Non-Color")
    plaster_n = _image("PlasterNrm", p_nrm, "Non-Color")
    niche_alb = _image("NicheAlb", _scale_albedo(p_alb, 0.55), "sRGB")
    timber = _image("TimberAlb", t_alb, "sRGB")
    timber_r = _image("TimberRgh", t_rgh, "Non-Color")
    timber_n = _image("TimberNrm", t_nrm, "Non-Color")
    iron_a = _image("IronAlb", i_alb, "sRGB")
    iron_r = _image("IronRgh", i_rgh, "Non-Color")
    iron_n = _image("IronNrm", i_nrm, "Non-Color")
    rug_a = _image("RugAlb", r_alb, "sRGB")
    rug_r = _image("RugRgh", r_rgh, "Non-Color")
    cloth_a = _image("ClothAlb", c_alb, "sRGB")
    cloth_r = _image("ClothRgh", c_rgh, "Non-Color")
    paper_a = _image("PaperAlb", a_alb, "sRGB")
    paper_r = _image("PaperRgh", a_rgh, "Non-Color")
    return {
        "floor": make_tex_mat("Floor", floor, floor_r, floor_n, specular=0.5),
        "wall": make_tex_mat("Wall", plaster, plaster_r, plaster_n, specular=0.28),
        "niche": make_tex_mat("Niche", niche_alb, plaster_r, plaster_n, specular=0.22),
        "ceiling": make_tex_mat("Ceiling", plaster, plaster_r, plaster_n, specular=0.22),
        "timber": make_tex_mat("Timber", timber, timber_r, timber_n, specular=0.46),
        "iron": make_tex_mat("Iron", iron_a, iron_r, iron_n, metal=0.78, specular=0.5),
        "rug": make_tex_mat("Rug", rug_a, rug_r, specular=0.18),
        "cloth": make_tex_mat("Cloth", cloth_a, cloth_r, specular=0.2),
        "paper": make_tex_mat("Paper", paper_a, paper_r, specular=0.22),
        "frame": make_tex_mat("Frame", iron_a, iron_r, iron_n, metal=0.12, specular=0.32),
    }


def build_room():
    # Night-ink shell. Albedo stays dark so the lightmap still carries the read.
    s = build_surfaces()
    wall, niche, floor = s["wall"], s["niche"], s["floor"]
    ceiling, timber, iron = s["ceiling"], s["timber"], s["iron"]
    rug, cloth, paper, frame = s["rug"], s["cloth"], s["paper"], s["frame"]
    facade = make_mat("Facade", (0.040, 0.044, 0.055), rough=0.86)
    stoop = make_mat("Stoop", (0.035, 0.038, 0.048), rough=0.9)
    shade = make_mat(
        "LampShade",
        (0.22, 0.12, 0.05),
        rough=0.45,
        emit=(1.0, 0.62, 0.22),
        emit_strength=4.0,
    )
    bulb = make_mat(
        "LampBulb",
        (0.40, 0.28, 0.12),
        rough=0.3,
        emit=(1.0, 0.74, 0.32),
        emit_strength=18.0,
    )

    # Shell ----------------------------------------------------------------
    add_box("Floor", (0, D * 0.5, -0.03), (W, D, 0.06), floor)
    add_box("Ceiling", (0, D * 0.5, H + 0.03), (W, D, 0.06), ceiling)
    add_box("BackWall", (0, D + T * 0.5, H * 0.5), (W, T, H), wall)
    add_box("RightWall", (W * 0.5 + T * 0.5, D * 0.5, H * 0.5), (T, D, H), wall)

    # Left wall split around the bollard niche (open to the floor).
    ny = NICHE_Y1 - NICHE_Y0
    add_box(
        "LeftWallFront",
        (-W * 0.5 - T * 0.5, NICHE_Y0 * 0.5, H * 0.5),
        (T, NICHE_Y0, H),
        wall,
    )
    back_len = D - NICHE_Y1
    add_box(
        "LeftWallBack",
        (-W * 0.5 - T * 0.5, NICHE_Y1 + back_len * 0.5, H * 0.5),
        (T, back_len, H),
        wall,
    )
    above_h = H - NICHE_Z1
    add_box(
        "LeftWallAbove",
        (-W * 0.5 - T * 0.5, NICHE_Y0 + ny * 0.5, NICHE_Z1 + above_h * 0.5),
        (T, ny, above_h),
        wall,
    )
    recess = (-W * 0.5) - NICHE_X_BACK  # positive depth
    mid_x = (NICHE_X_BACK + (-W * 0.5)) * 0.5
    add_box(
        "NicheBack",
        (NICHE_X_BACK - T * 0.5, NICHE_Y0 + ny * 0.5, NICHE_Z1 * 0.5),
        (T, ny, NICHE_Z1),
        niche,
    )
    add_box(
        "NicheSideA",
        (mid_x, NICHE_Y0 - T * 0.5, NICHE_Z1 * 0.5),
        (recess, T, NICHE_Z1),
        niche,
    )
    add_box(
        "NicheSideB",
        (mid_x, NICHE_Y1 + T * 0.5, NICHE_Z1 * 0.5),
        (recess, T, NICHE_Z1),
        niche,
    )
    add_box(
        "NicheTop",
        (mid_x, NICHE_Y0 + ny * 0.5, NICHE_Z1 + T * 0.5),
        (recess, ny, T),
        niche,
    )
    bollard_y = (NICHE_Y0 + NICHE_Y1) * 0.5
    add_cyl("Bollard", (mid_x, bollard_y, 0.26), 0.080, 0.52, iron, verts=8)
    add_cyl("BollardCap", (mid_x, bollard_y, 0.55), 0.105, 0.055, iron, verts=8)

    # Fenestra — dark street wall + jamb returns. Opening faces -Y (street).
    facade_y = -0.07
    facade_t = 0.10
    facade_x0, facade_x1 = -1.55, 1.55
    facade_z1 = 2.40
    add_box(
        "FacadeLeft",
        ((facade_x0 + OPEN_L) * 0.5, facade_y, facade_z1 * 0.5),
        (OPEN_L - facade_x0, facade_t, facade_z1),
        facade,
    )
    add_box(
        "FacadeRight",
        ((OPEN_R + facade_x1) * 0.5, facade_y, facade_z1 * 0.5),
        (facade_x1 - OPEN_R, facade_t, facade_z1),
        facade,
    )
    add_box(
        "FacadeSill",
        (0, facade_y, SILL * 0.5),
        (OPEN_R - OPEN_L, facade_t, SILL),
        facade,
    )
    add_box(
        "FacadeHead",
        (0, facade_y, (HEAD + facade_z1) * 0.5),
        (OPEN_R - OPEN_L, facade_t, facade_z1 - HEAD),
        facade,
    )
    # Jambs: dark frame thickness the eye meets at the opening.
    jamb_y = 0.04
    jamb_d = 0.12
    open_h = HEAD - SILL
    add_box(
        "JambLeft",
        (OPEN_L, jamb_y, SILL + open_h * 0.5),
        (0.055, jamb_d, open_h),
        frame,
    )
    add_box(
        "JambRight",
        (OPEN_R, jamb_y, SILL + open_h * 0.5),
        (0.055, jamb_d, open_h),
        frame,
    )
    add_box(
        "JambSill",
        (0, jamb_y, SILL),
        (OPEN_R - OPEN_L, jamb_d, 0.055),
        frame,
    )
    add_box(
        "JambHead",
        (0, jamb_y, HEAD),
        (OPEN_R - OPEN_L, jamb_d, 0.055),
        frame,
    )

    # Stoop outside the opening — catches cool spill.
    add_box("Stoop", (0, -0.62, -0.02), (2.10, 0.95, 0.08), stoop)

    # Counter with a toe-kick so the overhang bakes a crease.
    add_box("CounterBase", (-0.32, 1.66, 0.38), (1.08, 0.58, 0.76), timber)
    add_box("CounterTop", (-0.32, 1.60, 0.90), (1.28, 0.78, 0.055), timber)

    # Shelf against the right wall.
    add_box("ShelfBack", (1.145, 1.12, 0.95), (0.035, 0.82, 1.70), timber)
    add_box("ShelfUprightA", (1.02, 0.74, 0.95), (0.20, 0.035, 1.70), timber)
    add_box("ShelfUprightB", (1.02, 1.50, 0.95), (0.20, 0.035, 1.70), timber)
    for i, z in enumerate((0.46, 0.96, 1.46)):
        add_box(f"ShelfBoard{i}", (1.02, 1.12, z), (0.22, 0.74, 0.028), timber)

    furnish(timber, iron, rug, cloth, paper)

    # Practicals. Shades sit above the point lights so the pool is not sealed in.
    add_cyl("PendantShade", (-0.40, 1.55, 1.88), 0.15, 0.045, shade, verts=12)
    add_cyl("PendantBulb", (-0.40, 1.55, 1.78), 0.035, 0.05, bulb, verts=8)
    add_box("SconcePlate", (0.62, D - 0.02, 1.52), (0.16, 0.03, 0.22), shade)
    add_cyl("SconceBulb", (0.62, D - 0.06, 1.52), 0.028, 0.04, bulb, verts=8)
    add_cyl("CounterBulb", (0.10, 1.38, 1.00), 0.03, 0.045, bulb, verts=8)
    add_cyl("CounterShade", (0.10, 1.38, 1.06), 0.07, 0.03, shade, verts=10)

    # Lights (not joined). Watts tuned for a night room: warm pools, cool spill.
    add_point("LightPendant", (-0.40, 1.55, 1.64), (1.0, 0.64, 0.24), 110, 0.10)
    add_point("LightSconce", (0.62, D - 0.22, 1.48), (1.0, 0.58, 0.22), 28, 0.06)
    add_point("LightCounter", (0.10, 1.32, 1.02), (1.0, 0.72, 0.34), 16, 0.04)
    # Area at the street side of the opening, emitting +Y (into the room).
    # Local -Z of an area lamp maps to world +Y at Euler X = +90°.
    add_area(
        "LightFenestra",
        (0.0, -1.05, 1.15),
        (math.radians(90), 0.0, 0.0),
        (0.45, 0.58, 0.95),
        55,
        1.40,
        1.50,
    )
    add_area(
        "LightStoop",
        (0.0, -0.62, 2.15),
        (0.0, 0.0, 0.0),
        (0.55, 0.62, 0.90),
        6,
        1.4,
        0.8,
    )


def join_meshes():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    bay = bpy.context.view_layer.objects.active
    bay.name = "QuayBay"
    return bay


def view3d_override():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    return {"window": win, "area": area, "region": region}


def unwrap(bay):
    bpy.ops.object.select_all(action="DESELECT")
    bay.select_set(True)
    bpy.context.view_layer.objects.active = bay
    ov = view3d_override()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    with bpy.context.temp_override(**ov):
        # Unique atlas for the lightmap. Albedo UVs are rewritten after the copy.
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
        bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    # uv_layers.new copies the active layer. Order: UVMap = TEXCOORD_0, Lightmap = TEXCOORD_1.
    if "Lightmap" not in bay.data.uv_layers:
        bay.data.uv_layers.new(name="Lightmap")
    bay.data.uv_layers["Lightmap"].active_render = True
    box_project_uv(bay, "UVMap")
    bay.data.uv_layers["UVMap"].active = True
    return bay


def box_project_uv(bay, uv_name):
    """Metre-space UVs so tiling grit follows the surface. Plaster V is wall height."""
    mesh = bay.data
    uv = mesh.uv_layers[uv_name]
    plaster_names = {"Wall", "Niche", "Ceiling"}
    for poly in mesh.polygons:
        mat = mesh.materials[poly.material_index] if mesh.materials else None
        name = mat.name if mat else ""
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        vertical = not (az >= ax and az >= ay)
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if az >= ax and az >= ay:
                u, v = co.x, co.y
            elif ay >= ax:
                u, v = co.x, co.z
            else:
                u, v = co.y, co.z
            if name == "Ceiling":
                # Stay in the clean band of the plaster tile — no floor-dirt stripe.
                u, v = co.x, 0.40 + (co.y / D) * 0.35
            elif name in plaster_names and vertical:
                v = v / H
            uv.data[li].uv = (u, v)


def new_image(name, colorspace):
    img = bpy.data.images.new(name, RES, RES, alpha=False, float_buffer=True)
    img.colorspace_settings.name = colorspace
    img.generated_color = (0.0, 0.0, 0.0, 1.0)
    return img


def point_materials_at(bay, image):
    for slot in bay.material_slots:
        mat = slot.material
        nt = mat.node_tree
        # One target node per material; replace if re-baking.
        node = nt.nodes.get("BakeTarget")
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.name = "BakeTarget"
            node.location = (280, 120)
        node.image = image
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node


def bake(scene, bay, image, bake_type, passes=None):
    point_materials_at(bay, image)
    scene.render.bake.use_clear = True
    scene.render.bake.margin = 8 if RES >= 1536 else 16
    scene.render.bake.margin_type = "EXTEND"
    scene.render.bake.target = "IMAGE_TEXTURES"
    if passes:
        scene.render.bake.use_pass_direct = passes["direct"]
        scene.render.bake.use_pass_indirect = passes["indirect"]
        scene.render.bake.use_pass_color = passes["color"]
    bpy.ops.object.select_all(action="DESELECT")
    bay.select_set(True)
    bpy.context.view_layer.objects.active = bay
    print(f"A01 bake start {bake_type} {RES}px samples={SAMPLES}", flush=True)
    bpy.ops.object.bake(type=bake_type)
    print(f"A01 bake done {bake_type}", flush=True)


def normalize_lightmap(img):
    """Shoulder the lighting pass so MeshStandard (albedo * light / pi) still reads."""
    buf = array.array("f", img.pixels[:])
    n = RES * RES
    lums = []
    for i in range(n):
        r, g, b = buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if lum > 0.004:
            lums.append(lum)
    if not lums:
        raise RuntimeError("lightmap bake is empty — no lit texels")
    lums.sort()
    p95 = lums[min(len(lums) - 1, int(len(lums) * 0.95))]
    # Leave headroom for the warm pools; p95 ~ 1.15 linear before the Lambert 1/pi.
    scale = 1.15 / max(p95, 1e-4)
    hi = 0.0
    for i in range(n):
        for c in range(3):
            v = buf[i * 4 + c] * scale
            # Soft shoulder so practicals stay hot without a white stamp.
            if v > 1.2:
                v = 1.2 + (1.0 - math.exp(-(v - 1.2))) * 0.9
            buf[i * 4 + c] = v
            if v > hi:
                hi = v
        buf[i * 4 + 3] = 1.0
    img.pixels.foreach_set(buf)
    img.update()
    print(f"A01 lightmap scale {scale:.3f} p95_in {p95:.4f} max_out {hi:.3f}", flush=True)
    return {"scale": scale, "p95_in": p95, "max_out": hi}


def grade_ao(img):
    """Keep cavities dark without crushing the open floor."""
    buf = array.array("f", img.pixels[:])
    n = RES * RES
    for i in range(n):
        # AO bake is grayscale. A mild gamma pulls creases (counter lip, niche).
        v = buf[i * 4]
        v = max(0.0, min(1.0, v)) ** 1.28
        buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v
        buf[i * 4 + 3] = 1.0
    img.pixels.foreach_set(buf)
    img.update()


def _png_chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _lin_to_srgb_byte(c):
    c = 0.0 if c < 0.0 else (1.0 if c > 1.0 else c)
    if c <= 0.0031308:
        s = 12.92 * c
    else:
        s = 1.055 * (c ** (1.0 / 2.4)) - 0.055
    return int(s * 255.0 + 0.5)


def save_png(img, path, colorspace):
    """Write the float buffer ourselves.

    Blender 4.2 --background Image.save() emits a black PNG for generated
    float images even when image.pixels is populated. Do not switch back.
    """
    w, h = img.size
    src = array.array("f", img.pixels[:])  # bottom-up RGBA
    srgb = colorspace != "Non-Color"
    raw = bytearray()
    for y in range(h - 1, -1, -1):
        raw.append(0)  # PNG filter none
        row = y * w * 4
        for i in range(w):
            o = row + i * 4
            if srgb:
                raw.append(_lin_to_srgb_byte(src[o]))
                raw.append(_lin_to_srgb_byte(src[o + 1]))
                raw.append(_lin_to_srgb_byte(src[o + 2]))
            else:
                for c in range(3):
                    v = src[o + c]
                    v = 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)
                    raw.append(int(v * 255.0 + 0.5))
            raw.append(255)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            _png_chunk(b"IEND", b""),
        )
    )
    with open(path, "wb") as f:
        f.write(png)
    print(f"A01 wrote {path} ({len(png)} bytes)", flush=True)


def strip_bake_nodes(bay):
    for slot in bay.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get("BakeTarget")
        if node:
            nt.nodes.remove(node)


def export_assets(scene, bay, stats):
    os.makedirs(OUT, exist_ok=True)
    # TEXCOORD_0 stays the atlas; renderer lightMap/aoMap use TEXCOORD_1.
    bay.data.uv_layers["UVMap"].active = True
    bay.data.uv_layers["Lightmap"].active_render = True

    strip_bake_nodes(bay)
    glb = os.path.join(OUT, "quay-bay.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_yup=True,
        use_selection=False,
        export_apply=True,
    )
    print(f"A01 wrote {glb}", flush=True)

    manifest = {
        "name": "quay-bay",
        "units": "metres",
        "gltf": "Y-up",
        "opening": "plane z=0, interior extends -Z, floor y=0",
        "roomW": W,
        "roomD": D,
        "roomH": H,
        "openL": OPEN_L,
        "openR": OPEN_R,
        "openW": OPEN_R - OPEN_L,
        "sill": SILL,
        "head": HEAD,
        "lightmap": "quay-bay-lightmap.png",
        "ao": "quay-bay-ao.png",
        "combinedPreview": "quay-bay-combined.png",
        "uv0": "UVMap",
        "uv1": "Lightmap",
        "bake": {
            "engine": "Cycles",
            "samples": SAMPLES,
            "resolution": RES,
            "lightmap": "DIFFUSE direct+indirect, color pass off",
            "ao": "AO",
            "combined": "COMBINED preview only — not multiplied again in the drill",
            "normalize": stats,
        },
    }
    with open(os.path.join(OUT, "quay-bay.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    blend = os.path.join(OUT, "quay-bay.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"A01 wrote {blend}", flush=True)


def render_previews(scene):
    """Live-light stills so clutter and grit can be judged before the bake."""
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 480
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    cam_data = bpy.data.cameras.new("Preview")
    cam_data.lens = 32
    cam = bpy.data.objects.new("Preview", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = (
        ("/tmp/a01-bay-preview.png", (0.08, -1.65, 1.12), (0.0, 1.35, 0.95)),
        ("/tmp/a01-bay-preview-close.png", (0.12, -0.35, 1.02), (-0.05, 1.45, 0.9)),
    )
    for path, loc, target in shots:
        cam.location = loc
        direction = mathutils.Vector(target) - mathutils.Vector(loc)
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"A01 preview {path}", flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    scene = reset_scene()
    build_room()
    bay = join_meshes()
    unwrap(bay)
    if PREVIEW:
        render_previews(scene)
        return

    light = new_image("QuayBayLight", "sRGB")
    ao = new_image("QuayBayAO", "Non-Color")
    combined = new_image("QuayBayCombined", "sRGB")

    bake(
        scene,
        bay,
        light,
        "DIFFUSE",
        {"direct": True, "indirect": True, "color": False},
    )
    stats = normalize_lightmap(light)
    save_png(light, os.path.join(OUT, "quay-bay-lightmap.png"), "sRGB")

    bake(scene, bay, ao, "AO")
    grade_ao(ao)
    save_png(ao, os.path.join(OUT, "quay-bay-ao.png"), "Non-Color")

    # Beauty reference (albedo × light). Not wired as the runtime lightmap.
    bake(scene, bay, combined, "COMBINED")
    save_png(combined, os.path.join(OUT, "quay-bay-combined.png"), "sRGB")

    export_assets(scene, bay, stats)
    print("A01 bake pipeline complete", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"A01 bake failed: {exc}", file=sys.stderr, flush=True)
        raise
