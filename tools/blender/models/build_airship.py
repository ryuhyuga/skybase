# Dựng tàu bay "Skybase Airship" bằng script (Blender 4.2+ / 5.x), theo ảnh tham khảo:
# thân gỗ mạ đồng, mũi nhọn, 2 cánh quạt lớn 2 bên, buồng lái mái vòm đồng, bếp có ống khói, bánh răng, cánh đuôi.
# 2 tầng: boong (buồng lái + bếp) và dưới boong (khoang hàng + kho), có cầu thang, cửa ra vào, cửa sổ.
#
# Chạy (cần add-on skybase_tools trong tools/blender):
#   blender --background --python tools/blender/models/build_airship.py -- <thư mục game>
# Kết quả: tools/blender/models/airship.blend + <game>/public/models/airship.glb
#
# Toạ độ Blender: X phải, Y mũi tàu (+Y), Z lên. Boong ở Z = 0. Vào game: (x, z, -y).
# Nhãn (add-on): tường/đồ đạc = Va chạm; đèn = Phát sáng + Chiếu sáng; điểm mốc spot_* / eye_helm / board / trail_*.
# Thuộc tính "sb_hide" trên vật: nhóm bị ẩn khi nhân vật vào trong (upper / roof_wheel / roof_kitchen).
import json
import math
import os
import sys

import bpy  # bpy phải import trước bmesh khi chạy bằng module bpy (pip)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # tools/blender
import skybase_tools  # noqa: E402
from skybase_tools.palette import hex_to_linear  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GAME_ROOT = argv[0] if argv else os.path.abspath(os.path.join(HERE, "..", "..", ".."))

# ---------------- thông số chính (m) ----------------
DECK_Z = 0.0
BULWARK = 0.8            # mạn tàu cao hơn boong
LOWER_Z = -3.6           # sàn tầng dưới
CABIN_H = 3.0
# mặt cắt thân: (y, nửa bề rộng ở boong, độ sâu đáy dưới boong)
PROFILE = [(-15.0, 4.0, 3.6), (-12.0, 4.7, 5.2), (-8.0, 5.1, 6.1), (-3.0, 5.25, 6.5), (3.0, 5.2, 6.5),
           (8.0, 4.85, 6.0), (12.0, 4.0, 5.0), (15.0, 2.8, 3.8), (17.5, 1.3, 2.4), (18.6, 0.35, 1.4)]
LOWER = {"x": 3.4, "y0": -10.0, "y1": 10.0}                     # sàn tầng dưới (chữ nhật)
STAIR = {"x0": 1.6, "x1": 3.6, "y0": 4.0, "y1": 9.0}            # cầu thang: cao ở y1, thấp ở y0
WHEEL = {"x": 3.0, "y0": -2.0, "y1": 3.5}                        # buồng lái
KITCH = {"x": 3.0, "y0": -8.0, "y1": -2.0}                       # bếp
BULKHEAD_Y = 0.0                                                 # vách giữa khoang hàng (trước) và kho (sau)


def half_width(y):
    p = PROFILE
    if y <= p[0][0]:
        return p[0][1]
    for (y0, w0, _), (y1, w1, _) in zip(p, p[1:]):
        if y <= y1:
            return w0 + (w1 - w0) * (y - y0) / (y1 - y0)
    return p[-1][1]


def depth_at(y):
    p = PROFILE
    if y <= p[0][0]:
        return p[0][2]
    for (y0, _, d0), (y1, _, d1) in zip(p, p[1:]):
        if y <= y1:
            return d0 + (d1 - d0) * (y - y0) / (y1 - y0)
    return p[-1][2]


def hull_x(y, z, power=2.6):
    """Nửa bề rộng mặt ngoài thân tàu tại (y, z) với z <= 0 (theo cùng công thức siêu ellipse của section_ring)."""
    w, d = half_width(y), depth_at(y)
    t = min(1.0, abs(z) / d)
    return w * max(0.0, 1 - t ** power) ** (1 / power)


# ---------------- vật liệu ----------------
MATS = {}


def mat(name, hexcol, alpha=1.0, double=False, rough=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = hex_to_linear(hexcol)
    p.inputs["Roughness"].default_value = rough
    m.diffuse_color = hex_to_linear(hexcol)
    if alpha < 1.0:
        p.inputs["Alpha"].default_value = alpha
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        if hasattr(m, "blend_method"):
            try:
                m.blend_method = "BLEND"
            except Exception:
                pass
    m.use_backface_culling = not double
    MATS[name] = m
    return m


M = {}


def make_materials():
    M.update({
        "hull": mat("Thân tàu", 0x8E3B2B, double=True),
        "hullDark": mat("Thân tàu sẫm", 0x5C2A22, double=True),
        "plank": mat("Ván boong", 0xB98353, double=True),
        "wood": mat("Gỗ", 0x8B5B3A),
        "woodDark": mat("Gỗ sẫm", 0x5E3C27),
        "brass": mat("Đồng thau", 0xD9A848),
        "copper": mat("Đồng đỏ", 0xC8743A),
        "metal": mat("Kim loại sẫm", 0x4A4A55),
        "cream": mat("Kem", 0xF1E6CB, double=True),
        "wall": mat("Vách ca-bin", 0xE9D9B8),
        "glass": mat("Kính", 0xA8DDF2, alpha=0.32, double=True),
    "porthole": mat("Kính cửa sổ tròn", 0x9FD8EE, double=True),
        "flag": mat("Cờ", 0xD4643A, double=True),
        "flag2": mat("Cờ xanh", 0x3F8F98, double=True),
        "stove": mat("Bếp lò", 0x3A3A40),
        "crate": mat("Thùng gỗ", 0xA0703F),
        "sack": mat("Bao tải", 0xD8C49A),
        "rope": mat("Dây thừng", 0xC9A86A),
        "lamp": mat("Đèn lồng", 0xFFD28A),
        "red": mat("Đỏ", 0xC44B39),
        "green": mat("Xanh lá", 0x5AA63F),
    })

# ---------------- dựng hình ----------------
SHIP = None


def link(o, parent=None):
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent or SHIP
    return o


def mesh_obj(name, bm, material, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    return link(o, parent)


def box(name, sx, sy, sz, loc, material, collider=False, hide=None, rot=None, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((sx, sy, sz, 1)))
    o = mesh_obj(name, bm, material, parent)
    o.location = loc
    if rot:
        o.rotation_euler = rot
    o.skybase.collider = collider
    if hide:
        o["sb_hide"] = hide
    return o


def cyl(name, r, h, loc, material, axis="Z", seg=16, r2=None, collider=False, hide=None, parent=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    o = mesh_obj(name, bm, material, parent)
    o.location = loc
    if axis == "X":
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "Y":
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.skybase.collider = collider
    if hide:
        o["sb_hide"] = hide
    return o


def sphere(name, r, loc, material, scale=(1, 1, 1), hemi=False, hide=None, parent=None, seg=20):
    bm = bmesh.new()
    res = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    for v in res["verts"]:
        if hemi:
            v.co.z = max(v.co.z, 0.0)
        v.co.x *= scale[0]
        v.co.y *= scale[1]
        v.co.z *= scale[2]
    o = mesh_obj(name, bm, material, parent)
    o.location = loc
    if hide:
        o["sb_hide"] = hide
    return o


def torus(name, R, r, loc, material, axis="Y", hide=None, parent=None, seg=32):
    bm = bmesh.new()
    verts = []
    ring = 8
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(ring):
            b = 2 * math.pi * j / ring
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            verts.append(bm.verts.new((x, y, z)))
    for i in range(seg):
        for j in range(ring):
            a = verts[i * ring + j]
            b = verts[((i + 1) % seg) * ring + j]
            c = verts[((i + 1) % seg) * ring + (j + 1) % ring]
            d = verts[i * ring + (j + 1) % ring]
            bm.faces.new((a, b, c, d))
    o = mesh_obj(name, bm, material, parent)
    o.location = loc
    if axis == "Y":
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == "X":
        o.rotation_euler = (0, math.pi / 2, 0)
    if hide:
        o["sb_hide"] = hide
    return o


def empty(name, loc, yaw=0.0, parent=None, kind="ARROWS"):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind
    o.empty_display_size = 0.6
    o.location = loc
    o["sb_yaw"] = yaw  # hướng nhân vật trong game (radian, 0 = về mũi tàu)
    o.skybase.role = "MARKER"
    return link(o, parent)


def lamp(name, loc, rng=9.0, size=0.28, hide=None, parent=None):
    o = sphere(name, size, loc, M["lamp"], hide=hide, parent=parent, seg=12)
    o.skybase.glow = True
    o.skybase.glow_strength = 3.0
    o.skybase.cast_light = True
    o.skybase.light_range = rng
    return o


def section_ring(y, w, d, n=10, power=2.6, top=BULWARK):
    """Mặt cắt thân tàu: từ mép mạn trái xuống đáy rồi lên mép mạn phải (siêu ellipse cho thân bầu)."""
    pts = [(-w, top)]
    for k in range(n + 1):
        phi = math.pi + (math.pi * k / n)       # pi -> 2pi
        c, s = math.cos(phi), math.sin(phi)
        x = w * math.copysign(abs(c) ** (2 / power), c)
        z = d * math.copysign(abs(s) ** (2 / power), s)
        pts.append((x, z))
    pts.append((w, top))
    return pts


def build_hull():
    bm = bmesh.new()
    rings = []
    for (y, w, d) in PROFILE:
        rings.append([bm.verts.new((x, y, z)) for (x, z) in section_ring(y, w, d)])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(len(r0) - 1):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    # mũi: thu về 1 điểm
    tip = bm.verts.new((0, 19.4, -0.2))
    last = rings[-1]
    for i in range(len(last) - 1):
        bm.faces.new((last[i], last[i + 1], tip))
    # đuôi: tấm ván phẳng (transom)
    bm.faces.new(list(reversed(rings[0])))
    hull = mesh_obj("Thân tàu", bm, M["hull"])
    # dải đồng chạy dọc mạn + dải gỗ sẫm dưới mạn
    for side in (-1, 1):
        bm = bmesh.new()
        prev = None
        for (y, w, d) in PROFILE[:-1]:
            a = bm.verts.new((side * (w + 0.06), y, BULWARK + 0.02))
            b = bm.verts.new((side * (w + 0.06), y, BULWARK - 0.22))
            if prev:
                f = bm.faces.new((prev[0], prev[1], b, a) if side > 0 else (prev[0], a, b, prev[1]))
                f.smooth = False
            prev = (a, b)
        mesh_obj(f"Viền đồng mạn {'phải' if side > 0 else 'trái'}", bm, M["brass"])
    return hull


def build_deck():
    """Sàn boong: lưới ô 0.5 m theo đường viền thân, chừa lỗ cầu thang."""
    bm = bmesh.new()
    step = 0.5
    y = PROFILE[0][0] + 0.25
    while y < 18.0:
        w = min(half_width(y), half_width(y + step)) - 0.05
        x = -w
        while x < w - 1e-6:
            x1 = min(x + step, w)
            cx, cy = (x + x1) / 2, y + step / 2
            in_hole = STAIR["x0"] <= cx <= STAIR["x1"] and STAIR["y0"] <= cy <= STAIR["y1"]
            if not in_hole:
                vs = [bm.verts.new((x, y, DECK_Z)), bm.verts.new((x1, y, DECK_Z)),
                      bm.verts.new((x1, y + step, DECK_Z)), bm.verts.new((x, y + step, DECK_Z))]
                bm.faces.new(vs)
            x = x1
        y += step
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    deck = mesh_obj("Sàn boong", bm, M["plank"])
    deck["sb_hide"] = "upper"
    # nắp hầm hàng (lưới) ở mũi
    box("Nắp hầm", 3.0, 3.0, 0.08, (-0.6, 11.5, 0.04), M["woodDark"], hide="upper")
    for i in range(5):
        box(f"Nan nắp hầm {i}", 3.0, 0.08, 0.1, (-0.6, 10.2 + i * 0.65, 0.09), M["brass"], hide="upper")
    return deck


def build_rails():
    """Lan can trên mép mạn: cột + thanh tay vịn."""
    ys = [y for y in frange(-14.6, 17.6, 1.6)]
    for side in (-1, 1):
        prev = None
        for y in ys:
            w = half_width(y) - 0.1
            p = Vector((side * w, y, BULWARK))
            cyl(f"Cột lan can {side}_{y:.1f}", 0.05, 0.5, (p.x, p.y, BULWARK + 0.25), M["brass"], seg=6, hide="upper")
            if prev:
                mid = (prev + p) / 2
                L = (p - prev).length
                o = cyl(f"Tay vịn {side}_{y:.1f}", 0.045, L, (mid.x, mid.y, BULWARK + 0.5), M["brass"], seg=6, hide="upper")
                o.rotation_euler = (0, 0, 0)
                o.rotation_mode = "QUATERNION"
                o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(p - prev)
            prev = p


def frange(a, b, s):
    v = a
    while v <= b + 1e-6:
        yield v
        v += s


def wall_with_openings(name, axis, fixed, a0, a1, z0, z1, openings, hide=None, t=0.2, material=None):
    """Tường thẳng (dọc trục 'x' hoặc 'y') từ a0..a1, có các lỗ (cửa / cửa sổ) [(b0, b1, zb0, zb1, glass?)]."""
    material = material or M["wall"]
    # chia theo dải dọc: giữa các lỗ là tường đặc; ở chỗ lỗ: phần dưới + phần trên
    cuts = sorted(openings, key=lambda o: o[0])
    x = a0
    parts = []
    for (b0, b1, zb0, zb1, glass) in cuts:
        if b0 > x:
            parts.append((x, b0, z0, z1))
        if zb0 > z0:
            parts.append((b0, b1, z0, zb0))
        if zb1 < z1:
            parts.append((b0, b1, zb1, z1))
        if glass:
            g = make_wall_box(f"{name} kính", axis, fixed, b0, b1, zb0, zb1, 0.04, M["glass"], hide)
            g.skybase.collider = False
        x = b1
    if x < a1:
        parts.append((x, a1, z0, z1))
    for i, (p0, p1, q0, q1) in enumerate(parts):
        o = make_wall_box(f"{name} {i}", axis, fixed, p0, p1, q0, q1, t, material, hide)
        o.skybase.collider = (q1 - q0) > 0.3 and q0 < 1.0  # phần thấp/đặc chặn người; phần trên cửa sổ không cần
    return parts


def make_wall_box(name, axis, fixed, a0, a1, z0, z1, t, material, hide):
    L, H = a1 - a0, z1 - z0
    mid, zc = (a0 + a1) / 2, (z0 + z1) / 2
    if axis == "x":   # tường chạy theo X, đặt ở y = fixed
        return box(name, L, t, H, (mid, fixed, zc), material, hide=hide)
    return box(name, t, L, H, (fixed, mid, zc), material, hide=hide)


def build_cabins():
    W, K = WHEEL, KITCH
    h = CABIN_H
    # ---- Buồng lái: kính lớn phía trước, cửa sổ hai bên, cửa bên trái ra boong, cửa sau thông sang bếp ----
    wall_with_openings("Buồng lái tường trước", "x", W["y1"], -W["x"], W["x"], 0, h,
                       [(-2.4, -0.9, 1.0, 2.5, True), (-0.7, 0.7, 1.0, 2.5, True), (0.9, 2.4, 1.0, 2.5, True)], hide="upper")
    wall_with_openings("Buồng lái tường trái", "y", -W["x"], W["y0"], W["y1"], 0, h,
                       [(-1.2, 0.0, 0.0, 2.3, False), (1.0, 2.8, 1.1, 2.4, True)], hide="upper")
    wall_with_openings("Buồng lái tường phải", "y", W["x"], W["y0"], W["y1"], 0, h,
                       [(-1.3, 0.3, 1.1, 2.4, True), (1.0, 2.8, 1.1, 2.4, True)], hide="upper")
    wall_with_openings("Vách buồng lái - bếp", "x", W["y0"], -W["x"], W["x"], 0, h,
                       [(-0.7, 0.7, 0.0, 2.3, False)], hide="upper")
    # ---- Bếp: cửa bên phải ra boong, cửa sổ tròn (vuông nhỏ) hai bên, tường sau ----
    wall_with_openings("Bếp tường trái", "y", -K["x"], K["y0"], K["y1"], 0, h,
                       [(-6.6, -5.4, 1.2, 2.2, True), (-4.2, -3.0, 1.2, 2.2, True)], hide="upper")
    wall_with_openings("Bếp tường phải", "y", K["x"], K["y0"], K["y1"], 0, h,
                       [(-6.8, -5.6, 0.0, 2.3, False), (-4.4, -3.2, 1.2, 2.2, True)], hide="upper")
    wall_with_openings("Bếp tường sau", "x", K["y0"], -K["x"], K["x"], 0, h,
                       [(-1.6, -0.4, 1.2, 2.2, True), (0.4, 1.6, 1.2, 2.2, True)], hide="upper")
    # khung cửa sổ đồng (trang trí) trên tường trước buồng lái
    for x0, x1 in ((-2.4, -0.9), (-0.7, 0.7), (0.9, 2.4)):
        box("Khung kính", x1 - x0 + 0.1, 0.26, 0.08, ((x0 + x1) / 2, W["y1"], 2.5), M["brass"], hide="upper")
        box("Khung kính", x1 - x0 + 0.1, 0.26, 0.08, ((x0 + x1) / 2, W["y1"], 1.0), M["brass"], hide="upper")
    # mái
    box("Mái buồng lái", 2 * W["x"] + 0.5, W["y1"] - W["y0"] + 0.5, 0.25, (0, (W["y0"] + W["y1"]) / 2, h + 0.12), M["woodDark"], hide="roof_wheel")
    box("Mái bếp", 2 * K["x"] + 0.5, K["y1"] - K["y0"] + 0.3, 0.25, (0, (K["y0"] + K["y1"]) / 2, h + 0.12), M["woodDark"], hide="roof_kitchen")
    # mái vòm đồng + chóp + cột cờ (như ảnh)
    sphere("Mái vòm đồng", 1.7, (0, 0.9, h + 0.24), M["brass"], hemi=True, hide="roof_wheel")
    torus("Đai mái vòm", 1.72, 0.08, (0, 0.9, h + 0.3), M["copper"], axis="Z", hide="roof_wheel")
    cyl("Chóp vòm", 0.35, 0.6, (0, 0.9, h + 2.15), M["brass"], hide="roof_wheel")
    for i in range(6):
        a = i / 6 * math.tau
        box(f"Cửa sổ chóp {i}", 0.16, 0.05, 0.3, (0.36 * math.cos(a), 0.9 + 0.36 * math.sin(a), h + 2.15), M["glass"],
            rot=(0, 0, a + math.pi / 2), hide="roof_wheel")
    cyl("Cột cờ vòm", 0.04, 2.2, (0, 0.9, h + 3.5), M["woodDark"], seg=6, hide="roof_wheel")
    flag("flag_dome", (0, 0.9, h + 4.5), 1.4, 0.7, M["flag"], hide="roof_wheel")
    # ống khói bếp (xuyên mái) + nắp
    cyl("Ống khói", 0.32, 4.2, (-2.1, -6.9, h + 1.4), M["copper"], hide="roof_kitchen")
    cyl("Nắp ống khói", 0.45, 0.25, (-2.1, -6.9, h + 3.6), M["brass"], hide="roof_kitchen")
    # bánh răng lớn bên mạn phải bếp (trang trí)
    gear("Bánh răng lớn", 1.25, (K["x"] + 0.18, -5.2, 1.7), hide="upper")
    gear("Bánh răng nhỏ", 0.75, (K["x"] + 0.22, -3.2, 2.4), hide="upper")
    # nóc cầu thang lên (cầu thang nhỏ lên mái buồng lái, trang trí) - bỏ qua


def gear(name, r, loc, hide=None):
    g = cyl(name, r, 0.18, loc, M["brass"], axis="X", seg=24, hide=hide)
    teeth = 14 if r > 1 else 10
    for i in range(teeth):
        a = i / teeth * math.tau
        t = box(f"{name} răng {i}", 0.18, 0.28, 0.28, (loc[0], loc[1] + (r + 0.1) * math.cos(a), loc[2] + (r + 0.1) * math.sin(a)),
                M["brass"], rot=(a, 0, 0), hide=hide)
    cyl(f"{name} trục", r * 0.25, 0.3, (loc[0] + 0.05, loc[1], loc[2]), M["copper"], axis="X", seg=12, hide=hide)
    return g


def flag(name, loc, L, H, material, hide=None):
    bm = bmesh.new()
    a = bm.verts.new((0, 0, 0))
    b = bm.verts.new((0, 0, -H))
    c = bm.verts.new((0, -L, -H * 0.5))
    bm.faces.new((a, b, c))
    o = mesh_obj(name, bm, material)
    o.location = loc
    if hide:
        o["sb_hide"] = hide
    return o


def build_interior():
    # ---- Buồng lái ----
    cyl("Trụ bánh lái", 0.12, 1.1, (0, 2.55, 0.55), M["woodDark"], collider=True, hide="upper")
    wheel = bpy.data.objects.new("wheel", None)
    wheel.location = (0, 2.45, 1.25)
    link(wheel)
    wheel["sb_hide"] = "upper"
    torus("Vành bánh lái", 0.5, 0.045, (0, 0, 0), M["woodDark"], axis="Y", parent=wheel)
    for i in range(4):
        o = box(f"Nan bánh lái {i}", 0.05, 0.05, 1.3, (0, 0, 0), M["wood"], parent=wheel)
        o.rotation_euler = (0, i * math.pi / 4, 0)
    cyl("Trục bánh lái", 0.09, 0.14, (0, 0, 0), M["brass"], axis="Y", parent=wheel)
    box("Bàn điều khiển", 2.6, 0.7, 1.0, (0, 3.05, 0.5), M["wood"], collider=True, hide="upper")
    for i, x in enumerate((-1.0, -0.6, 0.6, 1.0)):
        cyl(f"Đồng hồ {i}", 0.12, 0.05, (x, 3.0, 1.05), M["brass"], hide="upper")
        cyl(f"Cần gạt {i}", 0.025, 0.4, (x * 0.5, 2.85, 1.2), M["metal"], seg=6, hide="upper")
    cyl("Bệ la bàn", 0.12, 1.1, (1.6, 2.2, 0.55), M["woodDark"], collider=True, hide="upper")
    cyl("La bàn", 0.25, 0.1, (1.6, 2.2, 1.12), M["brass"], hide="upper")
    needle = bpy.data.objects.new("needle", None)
    needle.location = (1.6, 2.2, 1.19)
    link(needle)
    needle["sb_hide"] = "upper"
    box("Kim la bàn", 0.04, 0.32, 0.02, (0, 0.04, 0), M["red"], parent=needle)
    box("Bàn bản đồ", 1.2, 0.9, 0.9, (-2.2, 1.7, 0.45), M["wood"], collider=True, hide="upper")
    box("Bản đồ", 1.0, 0.7, 0.02, (-2.2, 1.7, 0.92), M["cream"], hide="upper")
    lamp("Đèn buồng lái", (0, 0.5, 2.55), rng=8.0, hide="upper")
    # ---- Bếp ----
    box("Bếp lò", 1.3, 1.0, 1.0, (-2.1, -6.9, 0.5), M["stove"], collider=True, hide="upper")
    box("Mặt bếp đồng", 1.36, 1.06, 0.06, (-2.1, -6.9, 1.02), M["brass"], hide="upper")
    cyl("Nồi", 0.28, 0.35, (-2.3, -6.8, 1.22), M["metal"], hide="upper")
    box("Quầy bếp", 0.8, 3.2, 0.95, (-2.5, -4.2, 0.47), M["wood"], collider=True, hide="upper")
    for i in range(4):
        cyl(f"Hũ {i}", 0.1, 0.25, (-2.5, -5.2 + i * 0.55, 1.08), [M["red"], M["green"], M["copper"], M["cream"]][i], seg=10, hide="upper")
    box("Kệ bếp", 0.35, 3.0, 0.06, (-2.8, -4.2, 2.0), M["woodDark"], hide="upper")
    box("Bàn ăn", 1.4, 1.0, 0.08, (0.6, -5.0, 0.8), M["wood"], collider=True, hide="upper")
    for dx, dy in ((-0.6, -0.4), (0.6, -0.4), (-0.6, 0.4), (0.6, 0.4)):
        box("Chân bàn", 0.08, 0.08, 0.8, (0.6 + dx, -5.0 + dy, 0.4), M["woodDark"], hide="upper")
    for y in (-5.5, -4.5):
        cyl("Ghế đẩu", 0.22, 0.45, (1.9, y, 0.22), M["woodDark"], hide="upper")
    lamp("Đèn bếp", (0.4, -5.0, 2.6), rng=8.0, hide="upper")
    # ---- Tầng dưới: khoang hàng (trước) + kho (sau) ----
    z = LOWER_Z
    fw = min(hull_x(LOWER["y0"], z), hull_x(LOWER["y1"], z)) - 0.05
    box("Sàn tầng dưới", 2 * fw, LOWER["y1"] - LOWER["y0"], 0.12, (0, 0, z - 0.06), M["woodDark"])
    for yb in (LOWER["y0"], LOWER["y1"]):
        box("Vách ngăn đầu", 2 * hull_x(yb, z / 2) - 0.1, 0.15, -z, (0, yb, z / 2), M["hullDark"], collider=True)
    wall_with_openings("Vách khoang hàng - kho", "x", BULKHEAD_Y, -LOWER["x"] - 0.6, LOWER["x"] + 0.6, z, z + 3.4,
                       [(-0.8, 0.8, z, z + 2.3, False)], material=M["woodDark"])
    # tường che dưới cầu thang
    box("Vách dưới cầu thang", 0.12, STAIR["y1"] - STAIR["y0"], 3.4, (STAIR["x0"] - 0.06, (STAIR["y0"] + STAIR["y1"]) / 2, z + 1.7),
        M["woodDark"], collider=True)
    # cửa sổ tròn (ô kính + viền đồng) dọc 2 mạn ở tầng dưới
    for side in (-1, 1):
        for y in (-8.0, -5.0, -2.0, 2.0, 5.0, 8.0):
            w = hull_x(y, z + 1.6)
            for dx, nm in ((0.06, "ngoài"), (-0.08, "trong")):
                torus(f"Viền cửa sổ tròn {nm} {side}_{y}", 0.38, 0.07, (side * (w + dx), y, z + 1.6), M["brass"], axis="X")
            cyl(f"Kính cửa sổ tròn {side}_{y}", 0.34, 0.3, (side * w, y, z + 1.6), M["porthole"], axis="X", seg=16)
    # khoang hàng: thùng, thùng tô-nô, cuộn dây
    for i, (x, y, s) in enumerate([(-2.6, 2.4, 1.0), (-2.6, 3.5, 1.0), (-1.5, 2.4, 1.0), (-2.6, 2.95, 0.9), (-2.4, 8.6, 1.1),
                                   (-1.2, 8.6, 1.1), (-2.4, 7.4, 1.0)]):
        zz = z + s / 2 + (1.0 if i == 3 else 0.0)
        box(f"Thùng hàng {i}", s, s, s, (x, y, zz), M["crate"], collider=(i != 3))
    for i, (x, y) in enumerate([(0.6, 9.2), (1.2, 8.6), (-0.4, 5.5)]):
        cyl(f"Thùng tô-nô {i}", 0.42, 1.0, (x, y, z + 0.5), M["wood"], collider=True)
        torus(f"Đai tô-nô {i}", 0.43, 0.03, (x, y, z + 0.25), M["metal"], axis="Z")
        torus(f"Đai tô-nô {i}b", 0.43, 0.03, (x, y, z + 0.75), M["metal"], axis="Z")
    torus("Cuộn dây thừng", 0.45, 0.12, (2.4, 1.5, z + 0.13), M["rope"], axis="Z")
    lamp("Đèn khoang hàng", (0, 5.0, z + 3.0), rng=10.0)
    # kho: kệ, bao tải
    for i, y in enumerate((-9.0, -7.2, -5.4)):
        # kệ hở: 2 vách bên + 3 tấm ván, đồ đặt trên ván
        for dy in (-0.78, 0.78):
            box(f"Vách kệ {i}{dy:+.0f}", 0.6, 0.06, 2.4, (-3.0, y + dy, z + 1.2), M["woodDark"], collider=True)
        for k, hz in enumerate((0.15, 0.95, 1.75)):
            box(f"Ván kệ {i}{k}", 0.6, 1.6, 0.06, (-3.0, y, z + hz), M["wood"], collider=k > 0)
        cols = [M["crate"], M["sack"], M["copper"], M["green"], M["red"], M["cream"]]
        for j in range(3):
            for k, hz in enumerate((0.18, 0.98, 1.78)):
                if (i + j + k) % 4 == 3:
                    continue
                if (j + k) % 2:
                    cyl(f"Hũ kệ {i}{j}{k}", 0.16, 0.38, (-3.0, y - 0.5 + j * 0.5, z + hz + 0.19), cols[(i + j + k) % 6], seg=10)
                else:
                    box(f"Hộp trên kệ {i}{j}{k}", 0.42, 0.42, 0.36, (-3.0, y - 0.5 + j * 0.5, z + hz + 0.18), cols[(i * 2 + j) % 3])
    for i, (x, y) in enumerate([(2.6, -8.6), (2.0, -8.9), (2.8, -7.6), (2.3, -2.0)]):
        sphere(f"Bao tải {i}", 0.45, (x, y, z + 0.35), M["sack"], scale=(1, 1, 0.75), seg=12).skybase.collider = True
    lamp("Đèn kho", (0, -5.0, z + 3.0), rng=10.0)


def build_stairs():
    """Cầu thang xuống tầng dưới: bậc gỗ + tay vịn; quanh lỗ boong có lan can (chừa lối vào phía y1)."""
    s = STAIR
    n = 12
    for i in range(n):
        t = (i + 0.5) / n
        y = s["y0"] + (s["y1"] - s["y0"]) * t
        zz = LOWER_Z + (DECK_Z - LOWER_Z) * t
        box(f"Bậc thang {i}", s["x1"] - s["x0"], (s["y1"] - s["y0"]) / n, 0.12, ((s["x0"] + s["x1"]) / 2, y, zz - 0.06), M["wood"])
    L = math.hypot(s["y1"] - s["y0"], DECK_Z - LOWER_Z)
    ang = math.atan2(DECK_Z - LOWER_Z, s["y1"] - s["y0"])
    for x in (s["x0"] + 0.05, s["x1"] - 0.05):
        o = box("Thành thang", 0.08, L, 0.3, (x, (s["y0"] + s["y1"]) / 2, (LOWER_Z + DECK_Z) / 2 - 0.1), M["woodDark"])
        o.rotation_euler = (ang, 0, 0)
    # lan can quanh lỗ ở tầng boong: cột + tay vịn (tay vịn là va chạm, chừa lối vào phía y1)
    sides = [("trái", (s["x0"], s["y0"]), (s["x0"], s["y1"])), ("đầu", (s["x0"], s["y0"]), (s["x1"], s["y0"])),
             ("phải", (s["x1"], s["y0"]), (s["x1"], s["y1"]))]
    for nm, a, b in sides:
        a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        mid, L = (a + b) / 2, (b - a).length
        along_x = abs(b.x - a.x) > 1e-6
        box(f"Tay vịn lỗ thang {nm}", L if along_x else 0.08, 0.08 if along_x else L, 0.08, (mid.x, mid.y, 0.95), M["brass"],
            collider=True, hide="upper")
        box(f"Thanh giữa lỗ thang {nm}", L if along_x else 0.05, 0.05 if along_x else L, 0.05, (mid.x, mid.y, 0.5), M["brass"],
            hide="upper")
        n = max(2, int(L / 1.2) + 1)
        for k in range(n):
            p = a.lerp(b, k / (n - 1))
            cyl(f"Cột lỗ thang {nm}{k}", 0.04, 0.95, (p.x, p.y, 0.475), M["brass"], seg=6, hide="upper")


def build_propellers():
    for side, name in ((-1, "L"), (1, "R")):
        y = -0.5
        x0 = 5.2
        arm = cyl(f"Cần cánh quạt {name}", 0.28, 4.4, (side * (x0 + 2.0), y, 0.6), M["brass"], axis="X", seg=12)
        cyl(f"Vỏ động cơ {name}", 0.75, 2.6, (side * 9.4, y + 0.3, 0.6), M["copper"], axis="Y", seg=16)
        cyl(f"Mũi động cơ {name}", 0.75, 1.2, (side * 9.4, y + 2.2, 0.6), M["brass"], axis="Y", seg=16, r2=0.05)
        torus(f"Vành cánh quạt {name}", 3.2, 0.12, (side * 9.4, y + 1.1, 0.6), M["brass"], axis="Y", seg=40)
        for k in range(4):
            a = k / 4 * math.tau
            box(f"Thanh vành {name}{k}", 0.1, 0.1, 3.1, (side * 9.4 + 1.6 * math.sin(a), y + 1.1, 0.6 + 1.6 * math.cos(a)), M["brass"],
                rot=(0, a, 0))
        prop = bpy.data.objects.new(f"prop_{name}", None)
        prop.location = (side * 9.4, y + 1.25, 0.6)
        link(prop)
        for k in range(4):
            b = box(f"Cánh quạt {name}{k}", 0.55, 0.05, 2.9, (0, 0, 0), M["cream"], parent=prop)
            b.rotation_euler = (0, k * math.pi / 2, 0.25)
            b.location = (1.45 * math.sin(k * math.pi / 2), 0, 1.45 * math.cos(k * math.pi / 2))
        cyl(f"Chóp cánh quạt {name}", 0.3, 0.6, (0, 0.2, 0), M["brass"], axis="Y", r2=0.02, parent=prop)
        empty(f"trail_{name}", (side * 12.6, y + 1.1, 0.6))


def build_tail_and_bow():
    # cánh đuôi kiểu cánh dơi + vây đứng
    for side in (-1, 1):
        bm = bmesh.new()
        pts = [(side * 4.6, -12.0, 1.1), (side * 9.6, -15.5, 2.6), (side * 8.8, -16.8, 1.6), (side * 4.1, -14.6, 1.0)]
        vs = [bm.verts.new(p) for p in pts]
        bm.faces.new(vs if side > 0 else list(reversed(vs)))
        mesh_obj(f"Cánh đuôi {'phải' if side > 0 else 'trái'}", bm, M["cream"])
        for i in range(3):
            a = Vector(pts[0]).lerp(Vector(pts[3]), i / 2)
            b = Vector(pts[1]).lerp(Vector(pts[2]), i / 2)
            mid, L = (a + b) / 2, (b - a).length
            o = cyl(f"Gân cánh {side}{i}", 0.05, L, tuple(mid), M["woodDark"], seg=6)
            o.rotation_mode = "QUATERNION"
            o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(b - a)
        empty(f"trail_w{'R' if side > 0 else 'L'}", (side * 9.6, -15.6, 2.6))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in [(0, -14.9, 0.2), (0, -16.4, 0.0), (0, -18.4, 4.4), (0, -16.8, 4.8)]]
    bm.faces.new(vs)
    mesh_obj("Vây đuôi", bm, M["flag2"])
    # mũi: cột cờ + đèn lồng + mũi nhọn đồng
    cyl("Cột mũi", 0.08, 3.2, (0, 16.4, 1.6), M["woodDark"], seg=8, hide="upper", collider=True)
    flag("flag_bow", (0, 16.4, 3.1), 1.3, 0.6, M["flag"])
    lamp("Đèn lồng mũi", (0, 16.0, 2.2), rng=14.0, size=0.3)
    cyl("Mũi nhọn", 0.38, 6.0, (0, 21.4, -0.3), M["brass"], axis="Y", seg=12, r2=0.02)
    torus("Đai mũi nhọn", 0.4, 0.07, (0, 18.5, -0.3), M["copper"], axis="Y")
    # đèn lồng đuôi
    cyl("Cột đèn đuôi", 0.07, 2.4, (2.8, -13.6, 1.2), M["woodDark"], seg=8, hide="upper", collider=True)
    lamp("Đèn lồng đuôi", (2.8, -13.6, 2.5), rng=10.0, hide="upper")
    # ống xả đồng bên mạn (trang trí)
    for side in (-1, 1):
        for i, y in enumerate((-6.5, -3.5, 6.5)):
            cyl(f"Ống xả {side}{i}", 0.22, 1.2, (side * (hull_x(y, -1.0) + 0.62), y, -1.0), M["metal"], axis="X", seg=10)


def build_hammock_bench():
    for x in (-2.5, 2.5):
        cyl("Cột võng", 0.07, 1.4, (x, -11.0, 0.7), M["woodDark"], seg=8, collider=True, hide="upper")
    bm = bmesh.new()
    n = 12
    rows = []
    for i in range(n + 1):
        x = -2.4 + 4.8 * i / n
        sag = 0.35 * (1 - (x / 2.4) ** 2)
        rows.append([bm.verts.new((x, -11.0 + d, 1.0 - sag - 0.12 * (1 - abs(d) / 0.45))) for d in (-0.45, 0.0, 0.45)])
    for r0, r1 in zip(rows, rows[1:]):
        bm.faces.new((r0[0], r1[0], r1[1], r0[1]))
        bm.faces.new((r0[1], r1[1], r1[2], r0[2]))
    mesh_obj("Võng", bm, M["cream"])["sb_hide"] = "upper"
    box("Ghế băng mũi", 2.2, 0.6, 0.45, (0, 13.0, 0.22), M["wood"], collider=True, hide="upper")


def build_markers():
    empty("spot_helm", (0, 1.75, 0), 0.0)
    empty("eye_helm", (0, 0.85, 2.1), 0.0)  # sau bánh lái, cao hơn đầu chút: thấy bánh lái + kính trước
    empty("spot_hammock", (0, -11.0, 0.72), math.pi / 2)
    empty("stand_hammock", (0, -10.0, 0), 0.0)
    empty("spot_seat_bow", (0, 13.0, 0.47), 0.0)
    empty("stand_seat_bow", (0, 12.1, 0), 0.0)
    empty("spot_seat_kitchen", (1.9, -5.0, 0.47), math.pi / 2)
    empty("stand_seat_kitchen", (1.9, -6.2, 0), 0.0)
    empty("spot_lean_bow", (0, 15.6, 0), 0.0)
    empty("spot_lean_port", (-4.25, 8.0, 0), math.pi / 2)
    empty("spot_lean_stbd", (4.15, -11.6, 0), -math.pi / 2)
    empty("board", (-1.5, 9.5, 0), 0.0)


def main():
    global SHIP
    bpy.ops.wm.read_factory_settings(use_empty=True)
    skybase_tools.register()
    make_materials()
    sc = bpy.context.scene
    sc.unit_settings.system, sc.unit_settings.scale_length = "METRIC", 1.0
    SHIP = bpy.data.objects.new("Airship", None)
    sc.collection.objects.link(SHIP)
    build_hull()
    build_deck()
    build_rails()
    build_cabins()
    build_interior()
    build_stairs()
    build_propellers()
    build_tail_and_bow()
    build_hammock_bench()
    build_markers()
    SHIP.skybase.role = "PROP"
    # Bố cục cho game (sàn các tầng, cầu thang, vùng trong nhà) — nhúng vào glb (extras của scene)
    layout = {
        "deckZ": DECK_Z, "lowerZ": LOWER_Z, "bulwark": BULWARK, "profile": PROFILE, "lower": LOWER, "stair": STAIR,
        "rooms": {
            "wheelhouse": {"x": WHEEL["x"], "y0": WHEEL["y0"], "y1": WHEEL["y1"], "hide": ["roof_wheel"]},
            "kitchen": {"x": KITCH["x"], "y0": KITCH["y0"], "y1": KITCH["y1"], "hide": ["roof_kitchen"]},
        },
        "bulkheadY": BULKHEAD_Y,
    }
    sc["sb_layout"] = json.dumps(layout)
    s = sc.skybase
    s.game_root = GAME_ROOT
    s.model_name = "airship"
    s.scope = "VISIBLE"
    s.copy_code = False
    for o in sc.objects:
        o.select_set(False)
    res = bpy.ops.skybase.export(force=False)
    print("EXPORT", res)
    for it in bpy.context.window_manager.skybase_issues:
        print(" ", it.level, it.text, it.obj)
    out_blend = os.path.join(HERE, "airship.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out_blend, compress=True)
    print("SAVED", out_blend)


main()
