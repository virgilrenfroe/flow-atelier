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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "07-advanced-assets", "a01-bake")

# Room metres. Keep in quay-bay.json — Harbor hook and the drill read it.
W, D, H = 2.40, 2.10, 2.24
T = 0.08
OPEN_L, OPEN_R = -0.73, 0.73
SILL, HEAD = 0.42, 1.96
NICHE_Y0, NICHE_Y1, NICHE_Z1 = 0.38, 1.22, 1.30
NICHE_X_BACK = -1.58  # recess behind the left inner face (-W/2)

SAMPLES = 96
RES = 1024


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


def make_mat(name, color, rough=0.82, metal=0.0, emit=None, emit_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    if emit is not None and emit_strength > 0:
        bsdf.inputs["Emission Color"].default_value = (emit[0], emit[1], emit[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
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


def build_room():
    # Night-ink shell, warm timber, iron bollard. Albedo stays dark so the
    # lightmap (not a beige base color) carries the read.
    wall = make_mat("Wall", (0.085, 0.090, 0.110), rough=0.88)
    niche = make_mat("Niche", (0.045, 0.048, 0.062), rough=0.92)
    floor = make_mat("Floor", (0.105, 0.078, 0.055), rough=0.72)
    ceiling = make_mat("Ceiling", (0.055, 0.058, 0.070), rough=0.9)
    counter = make_mat("Counter", (0.155, 0.095, 0.055), rough=0.55)
    shelf = make_mat("Shelf", (0.090, 0.085, 0.100), rough=0.7)
    crate = make_mat("Crate", (0.130, 0.085, 0.050), rough=0.78)
    frame = make_mat("Frame", (0.025, 0.027, 0.034), rough=0.64, metal=0.08)
    facade = make_mat("Facade", (0.040, 0.044, 0.055), rough=0.86)
    stoop = make_mat("Stoop", (0.035, 0.038, 0.048), rough=0.9)
    iron = make_mat("Iron", (0.150, 0.155, 0.165), rough=0.38, metal=0.72)
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
    add_box("CounterBase", (-0.32, 1.66, 0.38), (1.08, 0.58, 0.76), counter)
    add_box("CounterTop", (-0.32, 1.60, 0.90), (1.28, 0.78, 0.055), counter)

    # Shelf against the right wall.
    add_box("ShelfBack", (1.145, 1.12, 0.95), (0.035, 0.82, 1.70), shelf)
    add_box("ShelfUprightA", (1.02, 0.74, 0.95), (0.20, 0.035, 1.70), shelf)
    add_box("ShelfUprightB", (1.02, 1.50, 0.95), (0.20, 0.035, 1.70), shelf)
    for i, z in enumerate((0.46, 0.96, 1.46)):
        add_box(f"ShelfBoard{i}", (1.02, 1.12, z), (0.22, 0.74, 0.028), shelf)
    add_box("ShelfCrate", (1.00, 1.05, 1.56), (0.14, 0.16, 0.12), crate)
    add_box("ShelfTin", (1.02, 1.28, 0.56), (0.10, 0.10, 0.16), iron)

    # Floor crate near the niche — crease against the wall.
    add_box("FloorCrate", (-0.78, 0.58, 0.15), (0.30, 0.26, 0.30), crate)

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
    for poly in bay.data.polygons:
        poly.use_smooth = False
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
        # Angle-limit unwrap, then pack. Lightmap is a copy of this atlas.
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.uv.pack_islands(margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    # uv_layers.new copies the active layer. Order: UVMap = TEXCOORD_0, Lightmap = TEXCOORD_1.
    if "Lightmap" not in bay.data.uv_layers:
        bay.data.uv_layers.new(name="Lightmap")
    bay.data.uv_layers["Lightmap"].active = True
    bay.data.uv_layers["Lightmap"].active_render = True
    return bay


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
    scene.render.bake.margin = 16
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


def main():
    os.makedirs(OUT, exist_ok=True)
    scene = reset_scene()
    build_room()
    bay = join_meshes()
    unwrap(bay)

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
