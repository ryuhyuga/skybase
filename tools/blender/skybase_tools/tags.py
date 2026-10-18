# Thao tác nhãn và màu palette cho nhiều vật cùng lúc.
import bpy

from .palette import PALETTE_BY_ID, hex_to_linear
from .props import ROLE_ITEMS

TAG_FIELDS = ("role", "toon", "block_clouds", "collider", "glow", "glow_strength", "glow_use_material", "glow_color")


def palette_material(pid: str):
    """Vật liệu dùng chung cho 1 màu palette (ít vật liệu = model nhẹ hơn)."""
    _, name, hx = PALETTE_BY_ID[pid]
    mname = f"SB {name}"
    m = bpy.data.materials.get(mname)
    if m is None:
        m = bpy.data.materials.new(mname)
        if hasattr(m, "use_nodes") and not m.node_tree:
            m.use_nodes = True
        p = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if p:
            p.inputs["Base Color"].default_value = hex_to_linear(hx)
            p.inputs["Roughness"].default_value = 1.0
        m.diffuse_color = hex_to_linear(hx)  # màu ở chế độ Solid
    return m


class SKYBASE_OT_set_role(bpy.types.Operator):
    bl_idname = "skybase.set_role"
    bl_label = "Đặt vai trò"
    bl_description = "Đặt vai trò cho tất cả vật đang chọn"
    bl_options = {"REGISTER", "UNDO"}
    role: bpy.props.EnumProperty(items=ROLE_ITEMS)

    def execute(self, context):
        objs = context.selected_objects
        for o in objs:
            o.skybase.role = self.role
            if self.role == "TERRAIN":
                o.skybase.collider = False  # địa hình dùng độ cao, không cần hộp va chạm
        self.report({"INFO"}, f"{len(objs)} vật -> {dict((i[0], i[1]) for i in ROLE_ITEMS)[self.role]}")
        return {"FINISHED"}


class SKYBASE_OT_copy_tags(bpy.types.Operator):
    bl_idname = "skybase.copy_tags"
    bl_label = "Chép nhãn sang vật đang chọn"
    bl_description = "Chép toàn bộ nhãn của vật active sang các vật đang chọn khác"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.active_object is not None and len(context.selected_objects) > 1

    def execute(self, context):
        src = context.active_object.skybase
        n = 0
        for o in context.selected_objects:
            if o == context.active_object:
                continue
            for f in TAG_FIELDS:
                setattr(o.skybase, f, getattr(src, f))
            n += 1
        self.report({"INFO"}, f"Đã chép nhãn sang {n} vật")
        return {"FINISHED"}


class SKYBASE_OT_apply_palette(bpy.types.Operator):
    bl_idname = "skybase.apply_palette"
    bl_label = "Tô màu"
    bl_description = "Gán màu palette của game cho vật đang chọn (thay vật liệu ở ô đang active)"
    bl_options = {"REGISTER", "UNDO"}
    pid: bpy.props.StringProperty()

    def execute(self, context):
        pid = self.pid or context.scene.skybase.palette_color
        m = palette_material(pid)
        n = 0
        for o in context.selected_objects:
            if o.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
                continue
            if not o.material_slots:
                o.data.materials.append(m)
            else:
                o.material_slots[o.active_material_index].material = m
            n += 1
        self.report({"INFO"}, f"Đã tô {n} vật")
        return {"FINISHED"}


classes = (SKYBASE_OT_set_role, SKYBASE_OT_copy_tags, SKYBASE_OT_apply_palette)
