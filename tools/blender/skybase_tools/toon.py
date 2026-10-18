# Xem trước kiểu toon trong Blender: chèn nhánh nút cel-shading 3 mảng vào vật liệu, giữ nguyên nhánh gốc
# để tắt là trở lại như cũ. Chỉ để NHÌN gần giống trong game; glTF luôn xuất vật liệu gốc.
import bpy

from .palette import hex_to_linear

PREFIX = "SB_TOON_"
# 3 mảng sáng giống gradientMap() của engine (90 / 170 / 255)
BANDS = [(0.0, 90 / 255), (0.12, 170 / 255), (0.45, 1.0)]


def _output(nt):
    outs = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"]
    for n in outs:
        if n.is_active_output:
            return n
    return outs[0] if outs else None


def _base_color_source(nt):
    """(socket đang nối vào Base Color, hoặc None, màu mặc định)."""
    p = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not p:
        return None, (0.8, 0.8, 0.8, 1.0), None
    bc = p.inputs["Base Color"]
    src = bc.links[0].from_socket if bc.links else None
    em = None
    try:
        strength = p.inputs["Emission Strength"].default_value
        if strength > 0:
            em = (tuple(p.inputs["Emission Color"].default_value), strength)
    except KeyError:
        pass
    return src, tuple(bc.default_value), em


def _mix_socket(node, name, kind):
    return next(s for s in node.inputs if s.name == name and s.type == kind)


def enable_material(mat, glow=0.0):
    if not mat or not mat.node_tree or mat.get("sb_toon_on"):
        return False
    nt = mat.node_tree
    out = _output(nt)
    if not out:
        return False
    surf = out.inputs["Surface"]
    if surf.links:
        link = surf.links[0]
        mat["sb_toon_orig"] = f"{link.from_node.name}|{link.from_socket.identifier}"
    else:
        mat["sb_toon_orig"] = ""
    src, base, em = _base_color_source(nt)
    if glow > 0 and not em:
        # vật có nhãn Phát sáng: xem trước bằng màu vật liệu x độ sáng
        em = (base if not src else (1.0, 0.8, 0.5, 1.0), glow)

    x, y = out.location.x, out.location.y - 320
    frame = nt.nodes.new("NodeFrame"); frame.name = PREFIX + "frame"; frame.label = "Skybase toon (xem trước)"
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse"); diff.name = PREFIX + "diffuse"
    s2r = nt.nodes.new("ShaderNodeShaderToRGB"); s2r.name = PREFIX + "s2r"
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.name = PREFIX + "ramp"
    mix = nt.nodes.new("ShaderNodeMix"); mix.name = PREFIX + "mul"
    emis = nt.nodes.new("ShaderNodeEmission"); emis.name = PREFIX + "emission"
    for i, n in enumerate((diff, s2r, ramp, mix, emis)):
        n.location = (x - 1000 + i * 200, y)
        n.parent = frame

    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    while len(cr.elements) < len(BANDS):
        cr.elements.new(0.5)
    for el, (pos, v) in zip(cr.elements, BANDS):
        el.position = pos
        el.color = (v, v, v, 1.0)

    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    a = _mix_socket(mix, "A", "RGBA")
    b = _mix_socket(mix, "B", "RGBA")
    nt.links.new(diff.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], a)
    if src:
        nt.links.new(src, b)
    else:
        b.default_value = base
    result = next(s for s in mix.outputs if s.type == "RGBA")
    nt.links.new(result, emis.inputs["Color"])
    emis.inputs["Strength"].default_value = 1.0
    if em:
        # Vật liệu có phát sáng: cộng thêm
        add = nt.nodes.new("ShaderNodeAddShader"); add.name = PREFIX + "add"; add.parent = frame
        glow = nt.nodes.new("ShaderNodeEmission"); glow.name = PREFIX + "glow"; glow.parent = frame
        glow.inputs["Color"].default_value = em[0]
        glow.inputs["Strength"].default_value = em[1]
        add.location = (x - 1000 + 5 * 200, y); glow.location = (x - 1000 + 4 * 200, y - 160)
        nt.links.new(emis.outputs["Emission"], add.inputs[0])
        nt.links.new(glow.outputs["Emission"], add.inputs[1])
        nt.links.new(add.outputs["Shader"], surf)
    else:
        nt.links.new(emis.outputs["Emission"], surf)
    mat["sb_toon_on"] = 1
    return True


def disable_material(mat):
    if not mat or not mat.node_tree or not mat.get("sb_toon_on"):
        return False
    nt = mat.node_tree
    for n in [n for n in nt.nodes if n.name.startswith(PREFIX)]:
        nt.nodes.remove(n)
    orig = mat.get("sb_toon_orig", "")
    out = _output(nt)
    if orig and out:
        node_name, sock_id = orig.split("|", 1)
        node = nt.nodes.get(node_name)
        if node:
            sock = next((s for s in node.outputs if s.identifier == sock_id), None)
            if sock:
                nt.links.new(sock, out.inputs["Surface"])
    for k in ("sb_toon_on", "sb_toon_orig"):
        if k in mat.keys():
            del mat[k]
    return True


def toon_state():
    return [m for m in bpy.data.materials if m.get("sb_toon_on")]


def toon_disable(mats):
    for m in mats:
        disable_material(m)


def toon_enable(mats):
    glow = {}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.skybase.glow:
            for s in o.material_slots:
                if s.material:
                    glow[s.material] = max(glow.get(s.material, 0.0), o.skybase.glow_strength)
    for m in mats:
        enable_material(m, glow.get(m, 0.0))


def _ensure_sun(context):
    if any(o.type == "LIGHT" and o.data.type == "SUN" for o in context.scene.objects):
        return
    light = bpy.data.lights.new("Skybase Nắng", type="SUN")
    light.energy = 3.0
    light.color = hex_to_linear(0xFFF1D8)[:3]
    o = bpy.data.objects.new("Skybase Nắng", light)
    o.rotation_euler = (0.85, 0.2, 0.6)
    o.skybase.role = "IGNORE"
    context.scene.collection.objects.link(o)


def _set_viewports(context):
    screen = context.screen
    if not screen:
        return
    for area in screen.areas:
        if area.type == "VIEW_3D":
            for sp in area.spaces:
                if sp.type == "VIEW_3D":
                    sp.shading.type = "MATERIAL"
                    sp.shading.use_scene_lights = True
                    sp.shading.use_scene_world = False


class SKYBASE_OT_toon_preview(bpy.types.Operator):
    bl_idname = "skybase.toon_preview"
    bl_label = "Xem trước toon"
    bl_description = "Bật/tắt xem trước cel-shading 3 mảng giống trong game (không ảnh hưởng file xuất)"
    bl_options = {"REGISTER", "UNDO"}
    enable: bpy.props.BoolProperty(default=True)

    def execute(self, context):
        if self.enable:
            mats = {}
            for o in context.scene.objects:
                if o.type != "MESH":
                    continue
                g = o.skybase.glow_strength if o.skybase.glow else 0.0
                for s in o.material_slots:
                    if s.material:
                        mats[s.material] = max(mats.get(s.material, 0.0), g)
            n = sum(1 for m, g in mats.items() if enable_material(m, g))
            _ensure_sun(context)
            _set_viewports(context)
            self.report({"INFO"}, f"Đã bật xem toon cho {n} vật liệu")
        else:
            mats = toon_state()
            toon_disable(mats)
            self.report({"INFO"}, f"Đã tắt xem toon ({len(mats)} vật liệu)")
        return {"FINISHED"}


classes = (SKYBASE_OT_toon_preview,)
