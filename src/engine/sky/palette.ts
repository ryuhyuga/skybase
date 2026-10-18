// BẢNG MÀU TOÀN GAME — chỉnh ở đây là cả thế giới đổi theo.
// Lấy từ ảnh tham khảo: trời cerulean kiểu anime, mây tích trắng bóng xanh ngọc,
// cỏ xanh vàng tươi, điểm nhấn cam gỉ sét / kem; biển xanh ngọc kiểu toon;
// mây vẽ cọ: đáy xanh lam đậm, thân trắng. Giá trị là hex sRGB.

/** Màu khí quyển theo độ cao mặt trời (độ). Hệ thống nội suy giữa các mốc. */
export interface AtmosphereKey {
  e: number;           // độ cao mặt trời
  zenith: number;      // đỉnh trời
  horizon: number;     // chân trời
  sun: number;         // màu nắng
  ambient: number;     // ánh sáng môi trường (bóng ngả màu này)
  cloudLit: number;    // mây phía có nắng
  cloudShade: number;  // mây phần bóng
  cloudDeep: number;   // đáy mây / bóng sâu
  fog: number;         // phối cảnh khí quyển (xa ngả màu này)
  water: number;       // mặt biển chính
  waterDeep: number;   // mảng nước đậm
  foam: number;        // bọt sóng
}

export const ATMOSPHERE: AtmosphereKey[] = [
  { e: -14, zenith: 0x050d42, horizon: 0x1a4cc0, sun: 0x8fa6d6, ambient: 0x22385a,
    cloudLit: 0x9fb8e6, cloudShade: 0x4c64a8, cloudDeep: 0x223276, fog: 0x173a8a,
    water: 0x0c3a5e, waterDeep: 0x082a48, foam: 0x7f9cc4 },   // đêm
  { e: -3,  zenith: 0x13287a, horizon: 0xb98aa0, sun: 0xd99a9a, ambient: 0x4a4a78,
    cloudLit: 0xf0c0b8, cloudShade: 0x9a8fc0, cloudDeep: 0x4c4fa8, fog: 0x8d7f9e,
    water: 0x3a6f9e, waterDeep: 0x2a5585, foam: 0xf2d0d0 },   // chạng vạng
  { e: 5,   zenith: 0x2a5d9a, horizon: 0xf4b98c, sun: 0xffb27a, ambient: 0x7b88b3,
    cloudLit: 0xffe4c4, cloudShade: 0xc2b0d6, cloudDeep: 0x5a64c8, fog: 0xe9bea4,
    water: 0x2f95c8, waterDeep: 0x2272a8, foam: 0xffe8d2 },   // hoàng hôn
  { e: 18,  zenith: 0x1666d4, horizon: 0xa6dcf4, sun: 0xfff1d8, ambient: 0x8fbdd0,
    cloudLit: 0xfffbf2, cloudShade: 0xcdd9f0, cloudDeep: 0x4d72d8, fog: 0xb6dbe0,
    water: 0x14aee6, waterDeep: 0x0b8fd2, foam: 0xffffff },   // sáng
  { e: 40,  zenith: 0x1262d8, horizon: 0x86ccf2, sun: 0xfffaf0, ambient: 0x86bfd6,
    cloudLit: 0xffffff, cloudShade: 0xd0dcf2, cloudDeep: 0x4a6fdc, fog: 0xa8d6e0,
    water: 0x10b2ea, waterDeep: 0x0a90d6, foam: 0xffffff },   // trưa
];

/** Màu vật thể (đảo, tàu). */
export const COLORS = {
  grass: 0x9bd24c,
  grassDark: 0x5aa63f,
  leaf: 0x3f9e52,
  leafDark: 0x2a7a45,
  trunk: 0x7a5236,
  rock: 0xc2b08f,      // đá vàng ấm
  rockMoss: 0x86a86a,  // đá phủ rêu, ngả xanh
  rockDark: 0x8a8f86,
  wall: 0xf1e6cb,      // kem
  roofs: [0xd8613a, 0xc44b39, 0x3f8f98, 0xe0a848],
  wood: 0x8b5b3a,
  woodDark: 0x5e3c27,
  brass: 0xd1a64c,
  hull: 0xd4643a,      // cam gỉ sét
  hullCream: 0xefe4c8,
  envelope: 0xf2e9d2,  // vỏ khí cầu
  envelopeStripe: 0xd4643a,
  lantern: 0xffd28a,
  beaconPickup: 0xffd36b,
  beaconDropoff: 0x7fe7ff,
  // Đảo trên biển + cỏ kiểu Ghibli
  sand: 0xead9a4,
  sandWet: 0xc9b98a,
  groundGrass: 0x4f8f36,   // nền dưới cỏ (gần màu gốc cỏ để không lộ khe)
  groundGrassLight: 0x6fae45,
  cliff: 0xa49a86,
  grassBase: 0x2c6b2e,     // gốc ngọn cỏ: xanh đậm
  grassTip: 0xa2d45a,      // ngọn cỏ: xanh vàng
  grassDry: 0xd8c46a,      // mảng cỏ úa vàng điểm xuyết
};
