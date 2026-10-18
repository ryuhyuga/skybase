# Dữ liệu của add-on: nhãn từng vật thể, cài đặt xuất theo cảnh, danh sách lỗi kiểm tra.
import bpy
from bpy.props import (BoolProperty, CollectionProperty, EnumProperty, FloatProperty,
                       FloatVectorProperty, PointerProperty, StringProperty)

from .palette import enum_items

ROLE_ITEMS = [
    ("PROP", "Vật thể", "Nhà, cây, đá, đồ vật… (mặc định)", "MESH_CUBE", 0),
    ("TERRAIN", "Địa hình", "Đất/đảo: có bờ cát ướt + bọt sóng, tàu & camera không xuyên qua", "MESH_GRID", 1),
    ("MARKER", "Điểm mốc", "Empty đánh dấu vị trí (điểm xuất phát, cầu cảng…), game đọc bằng tên", "EMPTY_AXIS", 2),
    ("IGNORE", "Không xuất", "Vật tham khảo, không đưa vào game", "HIDE_ON", 3),
]


class SkybaseTags(bpy.types.PropertyGroup):
    role: EnumProperty(name="Vai trò", items=ROLE_ITEMS, default="PROP")
    toon: BoolProperty(name="Kiểu toon", default=True,
                       description="Đổi vật liệu sang cel-shading 3 mảng giống phần còn lại của game")
    block_clouds: BoolProperty(name="Che mây", default=True,
                               description="Mây volumetric không vẽ đè lên vật này (nên luôn bật cho vật đặc)")
    collider: BoolProperty(name="Va chạm", default=False,
                           description="Game nhận được hộp va chạm của vật này (model.colliders)")
    glow: BoolProperty(name="Phát sáng", default=False,
                       description="Tự toả sáng + bloom (đèn, cửa sổ, pha lê…)")
    glow_strength: FloatProperty(name="Độ sáng", default=2.5, min=0.0, soft_max=10.0,
                                 description="> 1 thì bloom mới thấy rõ")
    glow_use_material: BoolProperty(name="Dùng màu vật liệu", default=True,
                                    description="Màu phát sáng = màu vật liệu; tắt để chọn màu riêng")
    glow_color: FloatVectorProperty(name="Màu sáng", subtype="COLOR", size=3, min=0.0, max=1.0,
                                    default=(1.0, 0.64, 0.27))


class SkybaseIssue(bpy.types.PropertyGroup):
    level: EnumProperty(items=[("ERROR", "Lỗi", ""), ("WARN", "Cảnh báo", ""), ("INFO", "Thông tin", "")])
    text: StringProperty()
    obj: StringProperty()


SCOPE_ITEMS = [
    ("SELECTED", "Vật đang chọn", "Chỉ xuất các vật đang chọn"),
    ("VISIBLE", "Vật đang hiện", "Xuất mọi vật đang hiện trong khung nhìn"),
    ("COLLECTION", "Collection đang mở", "Xuất mọi vật trong collection đang active"),
]


class SkybaseSettings(bpy.types.PropertyGroup):
    game_root: StringProperty(name="Thư mục game", subtype="DIR_PATH",
                              description="Folder gốc của game Skybase (folder có package.json). Model xuất vào public/models/")
    model_name: StringProperty(name="Tên file", default="",
                               description="Tên file .glb (để trống = tên file .blend)")
    scope: EnumProperty(name="Xuất", items=SCOPE_ITEMS, default="VISIBLE")
    copy_code: BoolProperty(name="Copy code load model", default=True,
                            description="Sau khi xuất, chép sẵn đoạn code loadModel(...) vào clipboard")
    palette_color: EnumProperty(name="Màu", items=enum_items())
    checked: BoolProperty(default=False)


classes = (SkybaseTags, SkybaseIssue, SkybaseSettings)


def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Object.skybase = PointerProperty(type=SkybaseTags)
    bpy.types.Scene.skybase = PointerProperty(type=SkybaseSettings)
    bpy.types.WindowManager.skybase_issues = CollectionProperty(type=SkybaseIssue)


def unregister():
    del bpy.types.WindowManager.skybase_issues
    del bpy.types.Scene.skybase
    del bpy.types.Object.skybase
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
