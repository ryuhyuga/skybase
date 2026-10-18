# Kiểm tra model trước khi xuất: tỉ lệ mét, transform, số tam giác, texture, nhãn.
import bpy
from mathutils import Vector

TRI_WARN = 150_000
TRI_ERROR = 500_000
TEX_WARN = 2048
# Nút vật liệu mà glTF xuất được (các nút khác bị bỏ qua, chỉ giữ màu cơ bản)
GLTF_NODES = {
    "BSDF_PRINCIPLED", "OUTPUT_MATERIAL", "TEX_IMAGE", "NORMAL_MAP", "MAPPING", "UVMAP",
    "TEX_COORD", "SEPARATE_COLOR", "SEPRGB", "SEPXYZ", "MIX", "MIX_RGB", "VERTEX_COLOR", "ATTRIBUTE",
    "EMISSION", "FRAME", "REROUTE", "BSDF_DIFFUSE", "SHADERTORGB", "VALTORGB",
}


def export_objects(context):
    """Các vật sẽ được xuất theo phạm vi đã chọn (đã bỏ vật 'Không xuất')."""
    s = context.scene.skybase
    vl = context.view_layer
    if s.scope == "SELECTED":
        objs = list(context.selected_objects)
    elif s.scope == "COLLECTION":
        objs = list(vl.active_layer_collection.collection.all_objects)
    else:
        objs = [o for o in context.scene.objects if o.visible_get(view_layer=vl)]
    return [o for o in objs if o.type in {"MESH", "EMPTY", "CURVE", "SURFACE", "META", "FONT"}
            and o.skybase.role != "IGNORE"]


def _bbox_world(objs):
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    found = False
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
            found = True
    return (lo, hi) if found else None


def run_checks(context):
    """Trả về danh sách (mức, nội dung, tên vật)."""
    out = []
    scene = context.scene
    us = scene.unit_settings
    if us.system != "METRIC" or abs(us.scale_length - 1.0) > 1e-6:
        out.append(("WARN", f"Đơn vị cảnh không phải mét (scale {us.scale_length:g}). Game tính 1 đơn vị = 1 m.", ""))

    objs = export_objects(context)
    if not objs:
        out.append(("ERROR", "Không có vật nào để xuất (xem lại phạm vi 'Xuất').", ""))
        return out

    depsgraph = context.evaluated_depsgraph_get()
    tris_total = 0
    for o in objs:
        tags = o.skybase
        sx, sy, sz = o.scale
        if min(sx, sy, sz) < 0:
            out.append(("ERROR", "Scale âm làm lật mặt (mặt bị đen/trong suốt). Áp scale (Ctrl+A).", o.name))
        elif max(abs(sx - 1), abs(sy - 1), abs(sz - 1)) > 1e-4 and o.type == "MESH":
            out.append(("WARN", f"Chưa áp scale ({sx:.2f}, {sy:.2f}, {sz:.2f}). Bấm 'Sửa tự động' hoặc Ctrl+A.", o.name))

        if tags.role == "TERRAIN" and o.type != "MESH":
            out.append(("ERROR", "Vai trò Địa hình nhưng không phải mesh.", o.name))
        if tags.role == "MARKER" and o.type == "MESH":
            out.append(("INFO", "Điểm mốc nên là Empty; mesh vẫn xuất nhưng game chỉ dùng vị trí.", o.name))
        if tags.collider and o.type != "MESH":
            out.append(("WARN", "Va chạm chỉ tính cho mesh.", o.name))

        if o.type != "MESH":
            continue
        ev = o.evaluated_get(depsgraph)
        me = ev.to_mesh()
        try:
            me.calc_loop_triangles()
            n = len(me.loop_triangles)
            tris_total += n
            if n == 0:
                out.append(("WARN", "Mesh rỗng (không có mặt nào).", o.name))
            has_uv = len(me.uv_layers) > 0
        finally:
            ev.to_mesh_clear()

        mats = [s.material for s in o.material_slots if s.material]
        if not mats and tags.role != "MARKER":
            out.append(("INFO", "Chưa có vật liệu, game sẽ tô màu trắng. Dùng 'Tô màu palette'.", o.name))
        for m in mats:
            if not m.node_tree:
                continue
            bad = sorted({n.type for n in m.node_tree.nodes if n.type not in GLTF_NODES and not n.name.startswith("SB_TOON")})
            if bad:
                out.append(("INFO", f"Vật liệu '{m.name}' có nút glTF không hiểu ({', '.join(bad[:3])}). Chỉ giữ màu/texture cơ bản.", o.name))
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    if not has_uv:
                        out.append(("ERROR", f"Dùng texture '{n.image.name}' nhưng mesh chưa có UV.", o.name))
                    w, h = n.image.size
                    if max(w, h) > TEX_WARN:
                        out.append(("WARN", f"Texture '{n.image.name}' {w}×{h} lớn, nên ≤ {TEX_WARN} cho web.", o.name))

    if tris_total > TRI_ERROR:
        out.append(("ERROR", f"Tổng {tris_total:,} tam giác, quá nặng cho web (nên < {TRI_WARN:,}). Dùng Decimate.", ""))
    elif tris_total > TRI_WARN:
        out.append(("WARN", f"Tổng {tris_total:,} tam giác, hơi nặng (nên < {TRI_WARN:,}).", ""))
    else:
        out.append(("INFO", f"Tổng {tris_total:,} tam giác.", ""))

    bb = _bbox_world(objs)
    if bb:
        size = bb[1] - bb[0]
        out.append(("INFO", f"Kích thước: {size.x:.1f} × {size.y:.1f} × {size.z:.1f} m (người cao ~1.8 m).", ""))
        if max(size) < 0.2:
            out.append(("WARN", "Model rất nhỏ (< 20 cm). Có thể đang làm theo cm? Game tính theo mét.", ""))
        if max(size) > 5000:
            out.append(("WARN", "Model lớn hơn 5 km. Kiểm tra lại tỉ lệ.", ""))
    if not any(o.skybase.role != "MARKER" for o in objs):
        out.append(("WARN", "Chỉ có điểm mốc, không có vật thể nào.", ""))
    return out


def store_issues(context, issues):
    coll = context.window_manager.skybase_issues
    coll.clear()
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    for level, text, obj in sorted(issues, key=lambda i: order[i[0]]):
        it = coll.add()
        it.level, it.text, it.obj = level, text, obj
    context.scene.skybase.checked = True


class SKYBASE_OT_check(bpy.types.Operator):
    bl_idname = "skybase.check"
    bl_label = "Kiểm tra"
    bl_description = "Kiểm tra tỉ lệ, transform, số tam giác, texture trước khi xuất"

    def execute(self, context):
        issues = run_checks(context)
        store_issues(context, issues)
        e = sum(1 for i in issues if i[0] == "ERROR")
        w = sum(1 for i in issues if i[0] == "WARN")
        self.report({"ERROR" if e else "WARNING" if w else "INFO"}, f"Kiểm tra xong: {e} lỗi, {w} cảnh báo")
        return {"FINISHED"}


class SKYBASE_OT_select_issue(bpy.types.Operator):
    bl_idname = "skybase.select_issue"
    bl_label = "Chọn vật"
    bl_description = "Chọn vật bị lỗi này"
    bl_options = {"REGISTER", "UNDO"}
    name: bpy.props.StringProperty()

    def execute(self, context):
        o = context.scene.objects.get(self.name)
        if not o:
            return {"CANCELLED"}
        for s in context.selected_objects:
            s.select_set(False)
        o.select_set(True)
        context.view_layer.objects.active = o
        return {"FINISHED"}


class SKYBASE_OT_autofix(bpy.types.Operator):
    bl_idname = "skybase.autofix"
    bl_label = "Sửa tự động"
    bl_description = "Đặt đơn vị mét và áp scale cho các vật sẽ xuất"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        us = context.scene.unit_settings
        us.system, us.scale_length = "METRIC", 1.0
        targets = [o for o in export_objects(context) if o.type == "MESH"
                   and (max(abs(v - 1) for v in o.scale) > 1e-4)]
        skipped = []
        if targets:
            prev_sel = list(context.selected_objects)
            prev_act = context.view_layer.objects.active
            for s in prev_sel:
                s.select_set(False)
            for o in targets:
                if o.data.users > 1:
                    skipped.append(o.name)  # mesh dùng chung: áp scale sẽ lỗi
                    continue
                o.select_set(True)
            context.view_layer.objects.active = next((o for o in targets if o.name not in skipped), None)
            if context.view_layer.objects.active:
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            for o in targets:
                o.select_set(False)
            for s in prev_sel:
                s.select_set(True)
            context.view_layer.objects.active = prev_act
        store_issues(context, run_checks(context))
        msg = f"Đã sửa {len(targets) - len(skipped)} vật"
        if skipped:
            msg += f"; bỏ qua {len(skipped)} vật dùng chung mesh (Object > Relations > Make Single User trước)"
        self.report({"INFO"}, msg)
        return {"FINISHED"}


classes = (SKYBASE_OT_check, SKYBASE_OT_select_issue, SKYBASE_OT_autofix)
