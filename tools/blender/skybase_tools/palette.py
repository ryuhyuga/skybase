# Bảng màu chép từ src/engine/sky/palette.ts (COLORS). Đổi palette trong game thì sửa cả ở đây.

PALETTE = [
    # (id, tên hiển thị, hex sRGB)
    ("wall", "Tường kem", 0xF1E6CB),
    ("roof_red", "Mái cam đỏ", 0xD8613A),
    ("roof_teal", "Mái xanh ngọc", 0x3F8F98),
    ("roof_gold", "Mái vàng", 0xE0A848),
    ("wood", "Gỗ", 0x8B5B3A),
    ("wood_dark", "Gỗ sẫm", 0x5E3C27),
    ("trunk", "Thân cây", 0x7A5236),
    ("leaf", "Lá", 0x3F9E52),
    ("leaf_dark", "Lá sẫm", 0x2A7A45),
    ("grass", "Cỏ", 0x9BD24C),
    ("grass_dark", "Cỏ sẫm", 0x5AA63F),
    ("ground_grass", "Nền cỏ", 0x4F8F36),
    ("sand", "Cát", 0xEAD9A4),
    ("rock", "Đá vàng", 0xC2B08F),
    ("rock_moss", "Đá rêu", 0x86A86A),
    ("rock_dark", "Đá xám", 0x8A8F86),
    ("cliff", "Vách đá", 0xA49A86),
    ("hull", "Cam gỉ sét", 0xD4643A),
    ("cream", "Kem nhạt", 0xEFE4C8),
    ("brass", "Đồng thau", 0xD1A64C),
    ("lantern", "Đèn lồng", 0xFFD28A),
    ("dome_blue", "Mái vòm xanh", 0x2F6FB8),
]

PALETTE_BY_ID = {p[0]: p for p in PALETTE}


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h: int) -> tuple:
    """Màu hex sRGB -> RGBA tuyến tính (Blender lưu màu tuyến tính)."""
    r, g, b = (h >> 16) & 255, (h >> 8) & 255, h & 255
    return (srgb_to_linear(r / 255), srgb_to_linear(g / 255), srgb_to_linear(b / 255), 1.0)


def enum_items():
    return [(pid, name, f"#{h:06X}") for pid, name, h in PALETTE]
