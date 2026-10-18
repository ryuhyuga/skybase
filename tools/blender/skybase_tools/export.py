# Xuất 1 nút: kiểm tra -> ghi nhãn thành glTF extras -> xuất .glb vào <game>/public/models/ -> copy code load.
import os
import re

import bpy

from .checks import export_objects, run_checks, store_issues

EXTRA_KEYS = ("sb_role", "sb_toon", "sb_clouds", "sb_collide", "sb_glow", "sb_glow_color")


def _hex(c) -> str:
    """Màu tuyến tính của Blender -> '#rrggbb' sRGB (three.js hiểu là sRGB)."""
    def to_srgb(v):
        v = max(0.0, min(1.0, v))
        return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    r, g, b = (round(to_srgb(x) * 255) for x in c[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def write_extras(o):
    """Nhãn -> custom property (glTF xuất thành extras, three.js đọc trong object.userData)."""
    t = o.skybase
    for k in EXTRA_KEYS:
        if k in o.keys():
            del o[k]
    o["sb_role"] = t.role.lower()
    if t.role == "MARKER":
        return
    o["sb_toon"] = 1 if t.toon else 0
    o["sb_clouds"] = 1 if t.block_clouds else 0
    o["sb_collide"] = 1 if t.collider else 0
    if t.glow:
        o["sb_glow"] = float(t.glow_strength)
        if not t.glow_use_material:
            o["sb_glow_color"] = _hex(t.glow_color)


def safe_name(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_\-]+", "-", s.strip()).strip("-").lower()
    return s or "model"


def resolve_paths(context):
    s = context.scene.skybase
    root = bpy.path.abspath(s.game_root) if s.game_root else ""
    name = s.model_name.strip() or (bpy.path.display_name_from_filepath(bpy.data.filepath) if bpy.data.filepath else "model")
    name = safe_name(name)
    return root, name


class SKYBASE_OT_export(bpy.types.Operator):
    bl_idname = "skybase.export"
    bl_label = "Xuất sang game"
    bl_description = "Kiểm tra rồi xuất .glb vào <thư mục game>/public/models/"
    bl_options = {"REGISTER"}

    force: bpy.props.BoolProperty(name="Xuất dù có lỗi", default=False)

    def execute(self, context):
        root, name = resolve_paths(context)
        if not root or not os.path.isdir(root):
            self.report({"ERROR"}, "Chưa chọn 'Thư mục game' (folder có package.json)")
            return {"CANCELLED"}
        if not os.path.isfile(os.path.join(root, "package.json")):
            self.report({"WARNING"}, "Thư mục game không có package.json; vẫn xuất vào public/models/")

        issues = run_checks(context)
        store_issues(context, issues)
        errors = [i for i in issues if i[0] == "ERROR"]
        if errors and not self.force:
            self.report({"ERROR"}, f"Có {len(errors)} lỗi, xem danh sách trong bảng Skybase (hoặc tick 'Xuất dù có lỗi')")
            return {"CANCELLED"}

        objs = export_objects(context)
        out_dir = os.path.join(root, "public", "models")
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{name}.glb")

        prev_sel = list(context.selected_objects)
        prev_act = context.view_layer.objects.active
        prev_mode = context.object.mode if context.object else "OBJECT"
        if prev_mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        try:
            for o in context.view_layer.objects:
                o.select_set(False)
            for o in objs:
                write_extras(o)
                o.select_set(True)
            # Tắt xem trước toon tạm thời để glTF lấy vật liệu gốc
            from .toon import toon_state, toon_disable, toon_enable
            mats_on = toon_state()
            if mats_on:
                toon_disable(mats_on)
            try:
                bpy.ops.export_scene.gltf(
                    filepath=path,
                    check_existing=False,
                    export_format="GLB",
                    use_selection=True,
                    export_extras=True,
                    export_apply=True,
                    export_yup=True,
                    export_cameras=False,
                    export_lights=False,
                    export_materials="EXPORT",
                    export_image_format="AUTO",
                )
            finally:
                if mats_on:
                    toon_enable(mats_on)
        finally:
            for o in context.view_layer.objects:
                o.select_set(False)
            for o in prev_sel:
                o.select_set(True)
            context.view_layer.objects.active = prev_act

        kb = os.path.getsize(path) / 1024
        url = f"models/{name}.glb"
        if context.scene.skybase.copy_code:
            context.window_manager.clipboard = (
                f"const {re.sub(r'[^A-Za-z0-9_]', '_', name)} = await loadModel(world, '{url}', "
                f"{{ position: new THREE.Vector3(0, 0, 0) }});"
            )
        self.report({"INFO"}, f"Đã xuất {len(objs)} vật -> public/{url} ({kb:.0f} KB)"
                    + (" · đã copy code" if context.scene.skybase.copy_code else ""))
        return {"FINISHED"}


classes = (SKYBASE_OT_export,)
