# Tạo nhanh vật mẫu đúng tỉ lệ mét, đã gắn nhãn + màu palette, đặt tại 3D cursor. Dùng làm điểm bắt đầu để sửa tiếp.
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from .tags import palette_material


def _new_object(context, name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    context.collection.objects.link(o)
    o.location = context.scene.cursor.location.copy()
    return o


def _add(bm, geom_fn, mat_index):
    """Chạy geom_fn(bm) và gán vật liệu cho các mặt mới; trả về kết quả của geom_fn."""
    before = set(bm.faces)
    res = geom_fn(bm)
    for f in bm.faces:
        if f not in before:
            f.material_index = mat_index
    return res


def _cyl(bm, r, h, z0=0.0, seg=10, r_top=None, xy=(0.0, 0.0)):
    return bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r_top is None else r_top,
                                 depth=h, matrix=Matrix.Translation((xy[0], xy[1], z0 + h / 2)))


def _ico(bm, r, at, sub=1):
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=Matrix.Translation(at))


def _box(bm, sx, sy, sz, at):
    m = Matrix.Translation(at) @ Matrix.Diagonal((sx, sy, sz, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def _select_only(context, objs):
    for s in context.selected_objects:
        s.select_set(False)
    for o in objs:
        o.select_set(True)
    context.view_layer.objects.active = objs[0]


def make_human(context):
    bm = bmesh.new()
    _cyl(bm, 0.22, 1.45, 0, 12)
    _ico(bm, 0.17, (0, 0, 1.62), 2)
    o = _new_object(context, "Thước người 1.8m", bm, [palette_material("hull")])
    o.skybase.role = "IGNORE"
    o.show_name = True
    return [o]


def make_tree(context):
    bm = bmesh.new()
    _add(bm, lambda b: _cyl(b, 0.35, 3.2, 0, 8, 0.25), 0)
    _add(bm, lambda b: _ico(b, 2.3, (0, 0, 4.3)), 1)
    _add(bm, lambda b: _ico(b, 1.6, (0.6, 0.3, 5.9)), 1)
    o = _new_object(context, "Cây", bm, [palette_material("trunk"), palette_material("leaf")])
    o.skybase.collider = True
    return [o]


def make_house(context):
    bm = bmesh.new()
    _add(bm, lambda b: _box(b, 6, 6, 4.5, (0, 0, 2.25)), 0)
    dome = _add(bm, lambda b: bmesh.ops.create_uvsphere(b, u_segments=16, v_segments=8, radius=2.3,
                                                        matrix=Matrix.Translation((0, 0, 4.5))), 1)
    # ép nửa dưới quả cầu lên mặt mái -> mái vòm
    for v in dome["verts"]:
        v.co.z = max(v.co.z, 4.5)
    _add(bm, lambda b: _box(b, 1.4, 0.2, 2.2, (0, -3.05, 1.1)), 2)  # cửa
    o = _new_object(context, "Nhà vòm", bm, [palette_material("wall"), palette_material("dome_blue"),
                                              palette_material("dome_blue")])
    o.skybase.collider = True
    return [o]


def make_lantern(context):
    bm = bmesh.new()
    _cyl(bm, 0.12, 3.4, 0, 8)
    _box(bm, 0.9, 0.12, 0.12, (0.4, 0, 3.3))
    post = _new_object(context, "Cột đèn", bm, [palette_material("wood_dark")])
    bm = bmesh.new()
    _box(bm, 0.45, 0.45, 0.6, (0, 0, 0))
    lamp = _new_object(context, "Đèn lồng", bm, [palette_material("lantern")])
    lamp.parent = post
    lamp.location = (0.75, 0, 2.85)
    lamp.skybase.glow = True
    lamp.skybase.glow_strength = 3.0
    lamp.skybase.collider = False
    return [post, lamp]


def make_dock(context):
    bm = bmesh.new()
    _add(bm, lambda b: _box(b, 4, 22, 0.35, (0, 0, 1.4)), 0)
    for x in (-1.8, 1.8):
        for y in (-10, -3.5, 3.5, 10):
            _add(bm, lambda b, x=x, y=y: _cyl(b, 0.22, 4.5, -3.0, 8, xy=(x, y)), 1)
    o = _new_object(context, "Cầu cảng", bm, [palette_material("wood"), palette_material("wood_dark")])
    o.skybase.collider = True
    mk = bpy.data.objects.new("dock", None)
    mk.empty_display_type = "SINGLE_ARROW"
    mk.empty_display_size = 3
    context.collection.objects.link(mk)
    mk.parent = o
    mk.location = (0, 11.5, 1.6)
    mk.skybase.role = "MARKER"
    return [o, mk]


def make_island(context, radius=70.0, height=16.0, seed=0.0):
    bm = bmesh.new()
    size = radius * 2.6
    bmesh.ops.create_grid(bm, x_segments=72, y_segments=72, size=size / 2)
    for v in bm.verts:
        d = v.co.xy.length / radius
        n = noise.noise(Vector((v.co.x * 0.03 + seed, v.co.y * 0.03, 0.5)))
        d2 = d + n * 0.18
        shape = max(0.0, 1.0 - d2)
        shape = shape * shape * (3 - 2 * shape)
        hills = 0.6 + 0.4 * noise.noise(Vector((v.co.x * 0.05, v.co.y * 0.05 + seed, 2.0)))
        # mép lưới chìm sâu hơn đáy biển của game (~9 m) để không lộ hình vuông dưới nước
        v.co.z = shape ** 1.3 * height * hills + shape * 4.0 - 4.5 - (1.0 - shape) * 9.0
    for f in bm.faces:
        zc = sum(v.co.z for v in f.verts) / len(f.verts)
        f.material_index = 1 if zc > 2.8 else 0
    o = _new_object(context, "Đảo", bm, [palette_material("sand"), palette_material("ground_grass")])
    o.skybase.role = "TERRAIN"
    for p in o.data.polygons:
        p.use_smooth = False
    return [o]


def make_marker(context):
    mk = bpy.data.objects.new("mốc", None)
    mk.empty_display_type = "ARROWS"
    mk.empty_display_size = 2
    context.collection.objects.link(mk)
    mk.location = context.scene.cursor.location.copy()
    mk.skybase.role = "MARKER"
    return [mk]


PREFABS = [
    ("HUMAN", "Thước người 1.8 m", "OUTLINER_OB_ARMATURE", make_human),
    ("ISLAND", "Đảo nhỏ (địa hình)", "MESH_GRID", make_island),
    ("HOUSE", "Nhà mái vòm", "HOME", make_house),
    ("TREE", "Cây", "OUTLINER_OB_POINTCLOUD", make_tree),
    ("LANTERN", "Cột đèn lồng (phát sáng)", "LIGHT_POINT", make_lantern),
    ("DOCK", "Cầu cảng + mốc 'dock'", "MOD_LATTICE", make_dock),
    ("MARKER", "Điểm mốc", "EMPTY_AXIS", make_marker),
]


class SKYBASE_OT_add_prefab(bpy.types.Operator):
    bl_idname = "skybase.add_prefab"
    bl_label = "Thêm vật mẫu"
    bl_description = "Tạo vật mẫu đúng tỉ lệ mét, đã gắn nhãn và màu, tại 3D cursor"
    bl_options = {"REGISTER", "UNDO"}
    kind: bpy.props.EnumProperty(items=[(k, n, "", i, idx) for idx, (k, n, i, _) in enumerate(PREFABS)])

    def execute(self, context):
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        fn = next(p[3] for p in PREFABS if p[0] == self.kind)
        objs = fn(context)
        _select_only(context, objs)
        self.report({"INFO"}, f"Đã thêm: {objs[0].name}")
        return {"FINISHED"}


classes = (SKYBASE_OT_add_prefab,)
