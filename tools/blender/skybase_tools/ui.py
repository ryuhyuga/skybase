# Bảng Skybase ở thanh bên khung 3D (phím N -> tab "Skybase").
import bpy

from .prefabs import PREFABS
from .props import ROLE_ITEMS

ICON = {"ERROR": "ERROR", "WARN": "INFO", "INFO": "DOT"}


class _Base:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Skybase"


class SKYBASE_PT_main(_Base, bpy.types.Panel):
    bl_label = "Skybase"

    def draw(self, context):
        col = self.layout.column(align=True)
        col.label(text="1 đơn vị = 1 m · mặt trước hướng +Y", icon="INFO")
        col.label(text="Mặt biển trong game ở Z = 0")


class SKYBASE_PT_tags(_Base, bpy.types.Panel):
    bl_label = "Nhãn vật thể"
    bl_parent_id = "SKYBASE_PT_main"

    def draw(self, context):
        lay = self.layout
        o = context.active_object
        if not o:
            lay.label(text="Chọn một vật để gắn nhãn")
            return
        t = o.skybase
        lay.label(text=f"{o.name}  ({len(context.selected_objects)} vật đang chọn)", icon="OBJECT_DATA")
        lay.label(text="Vai trò (áp cho mọi vật đang chọn):")
        grid = lay.grid_flow(columns=2, align=True)
        for rid, name, _, icon, _ in ROLE_ITEMS:
            op = grid.operator("skybase.set_role", text=name, icon=icon, depress=(t.role == rid))
            op.role = rid
        if t.role in {"MARKER", "IGNORE"}:
            if t.role == "MARKER":
                lay.label(text="Game lấy vị trí theo tên vật này", icon="INFO")
            return
        box = lay.box()
        row = box.row()
        row.prop(t, "toon")
        row.prop(t, "block_clouds")
        if t.role != "TERRAIN":
            box.prop(t, "collider")
        box.prop(t, "glow")
        if t.glow:
            sub = box.column(align=True)
            sub.prop(t, "glow_strength")
            sub.prop(t, "glow_use_material")
            if not t.glow_use_material:
                sub.prop(t, "glow_color")
            sub.prop(t, "cast_light")
            if t.cast_light:
                sub.prop(t, "light_range")
        lay.operator("skybase.copy_tags", icon="COPYDOWN")


class SKYBASE_PT_palette(_Base, bpy.types.Panel):
    bl_label = "Màu & xem trước"
    bl_parent_id = "SKYBASE_PT_main"

    def draw(self, context):
        lay = self.layout
        s = context.scene.skybase
        row = lay.row(align=True)
        row.prop(s, "palette_color", text="")
        row.operator("skybase.apply_palette", text="Tô màu", icon="BRUSH_DATA").pid = ""
        row = lay.row(align=True)
        row.operator("skybase.toon_preview", text="Xem toon", icon="SHADING_RENDERED").enable = True
        row.operator("skybase.toon_preview", text="Tắt", icon="SHADING_SOLID").enable = False


class SKYBASE_PT_prefabs(_Base, bpy.types.Panel):
    bl_label = "Tạo nhanh vật mẫu"
    bl_parent_id = "SKYBASE_PT_main"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        col = self.layout.column(align=True)
        for kind, name, icon, _ in PREFABS:
            col.operator("skybase.add_prefab", text=name, icon=icon).kind = kind


class SKYBASE_PT_export(_Base, bpy.types.Panel):
    bl_label = "Kiểm tra & xuất"
    bl_parent_id = "SKYBASE_PT_main"

    def draw(self, context):
        lay = self.layout
        s = context.scene.skybase
        lay.prop(s, "game_root")
        lay.prop(s, "model_name")
        lay.prop(s, "scope")
        lay.prop(s, "copy_code")
        row = lay.row(align=True)
        row.operator("skybase.check", icon="VIEWZOOM")
        row.operator("skybase.autofix", icon="TOOL_SETTINGS")
        issues = context.window_manager.skybase_issues
        if s.checked and issues:
            box = lay.box()
            for it in issues[:30]:
                r = box.row()
                r.alert = it.level == "ERROR"
                r.label(text=it.text, icon=ICON[it.level])
                if it.obj:
                    r.operator("skybase.select_issue", text="", icon="RESTRICT_SELECT_OFF").name = it.obj
            if len(issues) > 30:
                box.label(text=f"… và {len(issues) - 30} mục khác")
        big = lay.row()
        big.scale_y = 1.6
        big.operator("skybase.export", icon="EXPORT").force = False
        lay.operator("skybase.export", text="Xuất dù có lỗi", icon="ERROR").force = True


classes = (SKYBASE_PT_main, SKYBASE_PT_tags, SKYBASE_PT_palette, SKYBASE_PT_prefabs, SKYBASE_PT_export)
