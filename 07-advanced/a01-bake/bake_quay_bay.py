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

# Ground-floor fenestra sheet Harbor already binds as uShopAtlas.
# Cell 6 (row 1, col 2) is a dense photographic shop. The floor crop is that
# same cell's foreground, so the bay stays one interior. Apartments live on
# room-atlas-occupied-32.png (floors above 0); this bay sits on floor 0.
SHOP_ATLAS = os.path.join(ROOT, "06-intermediate-assets", "shop-atlas.png")
ROOM_ATLAS = os.path.join(ROOT, "06-intermediate-assets", "room-atlas-occupied-32.png")
SHOP_COLS, SHOP_ROWS = 4, 4
SHOP_CELL = 6
# Cell-local, top-left origin. The plate stops above the pale perspective
# wedge at the bottom of the cell (that wedge reads as promenade concrete).
PLATE_RECT = (28, 18, 484, 352)
# Warm interior grain from the same cell. The cell's bottom band is the
# pale wedge — do not use it as the floor.
FLOOR_RECT = (208, 36, 320, 100)
# Upper interior of the same cell, softened into side walls and ceiling.
WALL_RECT = (176, 28, 360, 150)
FLOOR_TILE_U = 1.05
FLOOR_TILE_V = 0.27

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


def _atlas_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = array.array("f", img.pixels[:])
    bpy.data.images.remove(img)
    return buf, w, h


def extract_atlas_image(name, path, cols, rows, index, rect=None, soften=0):
    """Crop one atlas cell (optional rect, top-left inside the cell).

    Photographic pixels stay as they are. soften averages the crop down so a
    side wall reads as that interior's color, not a second copy of the furniture.
    """
    buf, sw, sh = _atlas_pixels(path)
    cw, ch = sw // cols, sh // rows
    col, row = index % cols, index // cols
    ox, oy = col * cw, row * ch
    if rect is None:
        x0, y0, x1, y1 = 0, 0, cw, ch
    else:
        x0, y0, x1, y1 = rect
    tw, th = x1 - x0, y1 - y0
    if soften > 1:
        out_w = out_h = soften
    else:
        out_w, out_h = tw, th
    img = bpy.data.images.new(name, out_w, out_h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "sRGB"
    out = array.array("f", [1.0]) * (out_w * out_h * 4)

    def sample(px, py):
        px = 0 if px < 0 else (tw - 1 if px >= tw else px)
        py = 0 if py < 0 else (th - 1 if py >= th else py)
        src_y_top = oy + y0 + py
        src_y = sh - 1 - src_y_top
        src_x = ox + x0 + px
        o = (src_y * sw + src_x) * 4
        return buf[o], buf[o + 1], buf[o + 2]

    for dy in range(out_h):
        for dx in range(out_w):
            if soften > 1:
                # Wide box filter — photographic color, no readable furniture.
                sx0 = int(dx * tw / out_w)
                sx1 = max(sx0 + 1, int((dx + 1) * tw / out_w))
                sy0 = int(dy * th / out_h)
                sy1 = max(sy0 + 1, int((dy + 1) * th / out_h))
                acc = [0.0, 0.0, 0.0]
                n = 0
                for py in range(sy0, sy1):
                    for px in range(sx0, sx1):
                        c = sample(px, py)
                        acc[0] += c[0]
                        acc[1] += c[1]
                        acc[2] += c[2]
                        n += 1
                r, g, b = acc[0] / n, acc[1] / n, acc[2] / n
            else:
                r, g, b = sample(dx, dy)
            # Top of the photo at UV v = 1.
            dest_y = out_h - 1 - dy
            o = (dest_y * out_w + dx) * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = 1.0
    img.pixels.foreach_set(out)
    img.pack()
    return img


def make_photo_mat(name, image, rough=0.88, specular=0.1, extension="REPEAT"):
    """Base color only. A generated normal fights the photograph."""
    mat = make_mat(name, (1, 1, 1), rough=rough, specular=specular)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    uv.location = (-480, 40)
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Linear"
    node.extension = extension
    node.location = (-220, 40)
    nt.links.new(uv.outputs["UV"], node.inputs["Vector"])
    nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def add_box(name, loc, dims, mat):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.dimensions = dims
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


def build_surfaces():
    """Photographic atlas cells. No graded grit, no generated normals."""
    print("A01 sampling shop atlas cell", SHOP_CELL, flush=True)
    floor_img = extract_atlas_image(
        "AtlasFloorImg", SHOP_ATLAS, SHOP_COLS, SHOP_ROWS, SHOP_CELL, FLOOR_RECT
    )
    wall_img = extract_atlas_image(
        "AtlasWallImg", SHOP_ATLAS, SHOP_COLS, SHOP_ROWS, SHOP_CELL, WALL_RECT, soften=64
    )
    room_img = extract_atlas_image(
        "AtlasRoomImg", SHOP_ATLAS, SHOP_COLS, SHOP_ROWS, SHOP_CELL, PLATE_RECT
    )
    return {
        "floor": make_photo_mat("AtlasFloor", floor_img, rough=0.72, specular=0.16, extension="MIRROR"),
        "wall": make_photo_mat("AtlasWall", wall_img, rough=0.9, specular=0.08, extension="MIRROR"),
        "room": make_photo_mat("AtlasRoom", room_img, rough=0.84, specular=0.1, extension="EXTEND"),
    }


def build_room():
    # The opening frames one photographic shop. Contents live in the atlas
    # plate — not as low-poly props. Lights stay; their meshes do not.
    s = build_surfaces()
    floor, wall, room = s["floor"], s["wall"], s["room"]
    facade = make_mat("Facade", (0.040, 0.044, 0.055), rough=0.86)
    stoop = make_mat("Stoop", (0.035, 0.038, 0.048), rough=0.9)
    frame = make_mat("Frame", (0.03, 0.032, 0.04), rough=0.55, metal=0.15, specular=0.35)

    # Shell ----------------------------------------------------------------
    add_box("Floor", (0, D * 0.5, -0.03), (W, D, 0.06), floor)
    add_box("Ceiling", (0, D * 0.5, H + 0.03), (W, D, 0.06), wall)
    add_box("BackWall", (0, D + T * 0.5, H * 0.5), (W, T, H), wall)
    add_box("RightWall", (W * 0.5 + T * 0.5, D * 0.5, H * 0.5), (T, D, H), wall)
    add_box("LeftWall", (-W * 0.5 - T * 0.5, D * 0.5, H * 0.5), (T, D, H), wall)

    # Photographic interior, flush to the back wall. The crop already drops
    # the photo's floor so this plate meets the atlas floor instead of doubling it.
    plate_h = H - 0.01
    add_box(
        "RoomPlate",
        (0.0, D - 0.04, plate_h * 0.5 + 0.004),
        (W - 0.02, 0.012, plate_h),
        room,
    )

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

    # Lights (not joined). Watts and positions are the ones already framed.
    # No bulb meshes — those read as greybox in front of the photograph.
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
    assign_photo_uvs(bay)
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


def assign_photo_uvs(bay):
    """Unique photographic mapping. Runs after the lightmap UV is copied off."""
    mesh = bay.data
    uv = mesh.uv_layers["UVMap"]
    for poly in mesh.polygons:
        mat = mesh.materials[poly.material_index] if mesh.materials else None
        name = mat.name if mat else ""
        if not name.startswith("Atlas"):
            continue
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if name == "AtlasRoom":
                # Full plate. v grows with height so the photo's ceiling stays up.
                u = (co.x + W * 0.5) / W
                v = co.z / H
            elif name == "AtlasFloor":
                u = (co.x + W * 0.5) / FLOOR_TILE_U
                v = co.y / FLOOR_TILE_V
            elif az >= ax and az >= ay:
                u, v = (co.x + W * 0.5) / 1.8, co.y / 1.8
            elif ay >= ax:
                u, v = (co.x + W * 0.5) / 1.6, co.z / 1.6
            else:
                u, v = co.y / 1.6, co.z / 1.6
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


def quantize_float_images():
    """8-bit packed copies so quay-bay.blend does not keep 2048² float buffers."""
    for img in list(bpy.data.images):
        if img.size[0] < 2 or not getattr(img, "is_float", False):
            continue
        w, h = img.size
        name = img.name
        cs = img.colorspace_settings.name
        src = array.array("f", img.pixels[:])
        dst = bpy.data.images.new(name + "__8", w, h, alpha=True, float_buffer=False)
        dst.colorspace_settings.name = cs
        dst.pixels.foreach_set(src)
        dst.pack()
        img.user_remap(dst)
        bpy.data.images.remove(img)
        dst.name = name


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
    quantize_float_images()

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
        "atlas": {
            "shop": os.path.relpath(SHOP_ATLAS, ROOT),
            "occupied": os.path.relpath(ROOM_ATLAS, ROOT),
            "shopCell": SHOP_CELL,
            "shopCellCol": SHOP_CELL % SHOP_COLS,
            "shopCellRow": SHOP_CELL // SHOP_COLS,
            "room": "shop-atlas cell 6 photographic interior, pale floor wedge cropped off the plate",
            "floor": "shop-atlas cell 6 warm interior grain, not the pale bottom wedge",
            "walls": "shop-atlas cell 6 upper interior, softened",
        },
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
    """Live-light stills so the photographic plate can be judged before the bake."""
    if os.environ.get("A01_ALBEDO") == "1":
        for obj in scene.objects:
            if obj.type == "LIGHT":
                obj.data.energy = 0.0
        for mat in bpy.data.materials:
            nt = mat.node_tree
            if not nt:
                continue
            bsdf = nt.nodes.get("Principled BSDF")
            if bsdf is None:
                continue
            src = None
            for link in nt.links:
                if link.to_socket == bsdf.inputs["Base Color"]:
                    src = link.from_socket
                    break
            if src is not None:
                nt.links.new(src, bsdf.inputs["Emission Color"])
            else:
                bsdf.inputs["Emission Color"].default_value = bsdf.inputs["Base Color"].default_value
            bsdf.inputs["Emission Strength"].default_value = 1.0
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
