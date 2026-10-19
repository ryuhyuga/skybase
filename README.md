# Skybase

Base môi trường 3D phong cách anime, tách từ Skyship để dùng lại cho các game sau. Gồm:

- trời vẽ tay có chu kỳ ngày đêm, sao, dải ngân hà, trăng khuyết
- mây volumetric tả thực, kèm mây vẽ cọ làm bản nhẹ dự phòng
- biển stylized kiểu Codrops, bờ cát ướt và bọt sóng
- đảo trên biển, cỏ Ghibli
- sợi gió Wind Waker, speed lines, bloom
- âm thanh gió tự sinh
- bảng chỉnh thông số trong game (phím **G**)

Dựng bằng Three.js (WebGL), TypeScript và Vite.

## Chạy

Bấm đúp `start.bat`. Lần đầu nó tự chạy `npm install`, rồi mở trình duyệt.

Muốn chạy tay thì dùng `npm install` rồi `npm run dev`.

## Làm game mới từ base

1. Copy cả folder `skybase`, đổi tên thành tên game mới. Sửa `"name"` trong `package.json` và `<title>` trong `index.html`.
2. Giữ nguyên **`src/engine/`**. Thay **`src/demo/`** bằng code game của mình (folder demo có thể đổi tên thành `src/game/`, nhớ sửa đường dẫn script trong `index.html`).
3. Đặt `appId` riêng cho mỗi game để cấu hình bảng G không lẫn giữa các game.

Khung tối thiểu:

```ts
import * as THREE from 'three';
import { World, CameraRig, Input } from '../engine';

const world = new World({
  container: document.getElementById('app')!,
  appId: 'ten-game',
  islands: [{ x: 0, z: -800, radius: 300, height: 55, seed: 1 }], // đảo trên biển (tuỳ chọn)
  clearZones: [[0, 300, 0, 600]],                                  // vùng không mây [x, y, z, bán kính]
});
// Thêm nhân vật / tàu / xe của anh vào world.scene

const cam = new CameraRig(innerWidth / innerHeight);  // hoặc camera riêng
const input = new Input(world.renderer.domElement);
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(0.1, clock.getDelta());
  world.handleKeys(input);                  // C, G, B, M, [ ]
  // ... cập nhật nhân vật, rồi cam.update(dt, nhanVat, input)
  world.update(dt, { camera: cam.camera, cameraDistance: cam.distance, speed: 0, mode: cam.mode });
  world.render(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}
frame();
```

- **Camera của engine** bám theo bất kỳ object nào khớp interface `CameraTarget`: `position`, `yaw`, `speed`, `eye`, `body` (xem `demo/Ship.ts`). Game không cần camera này thì cứ truyền `PerspectiveCamera` riêng vào `world.update`.
- **Địa hình tự dựng** (load từ Blender, hoặc tự sinh như Santorini): gọi `applyShoreline(material)` để có bờ cát ướt và bọt sóng. Gọi `world.terrain.addHeightSource(fn)` để va chạm và camera biết độ cao.
- **Vật thể che mây** (nhà, tàu, núi): `obj.traverse(o => o.layers.enable(1))`. Thiếu bước này thì mây vẽ đè lên vật.
- **Thêm mục vào bảng G:** `world.panel?.section('Tên', 'TEN_BIEN', CFG, f => f.add(CFG, 'x', 0, 10))`. Giá trị tự lưu; nút "Copy cấu hình" chép ra để dán làm mặc định.

**Nhân vật:** `loadCharacter(world, 'models/character.glb')` + `CharacterController`.
- Có sẵn đứng, đi, chạy, nhảy, rơi, bơi, vẫy tay (Q).
- Có các tư thế ngồi, nằm, tựa lan can, cầm lái.
- Đi lại được trên vật đang bay hoặc trôi (boong tàu) qua `controller.board(platform, …)`.
- Animation làm thủ tục theo từng bộ phận nên không cần rig.

**Demo:**
- Bắt đầu bằng nhân vật đứng trên cầu cảng. Lại gần tàu bấm **F** để lên boong; trên boong bấm F để nhảy khỏi tàu.
- **Bánh lái** (bấm E):
  - Lái tay: góc 3 hoặc góc 1, bấm E để rời bánh lái.
  - Tự lái: chọn đảo để tới, tàu tự giữ độ cao và lượn quanh khi tới nơi.
  - Dừng tự lái.
- **Võng** (bấm E):
  - Ngủ trưa: tua nhanh khoảng 2 tiếng.
  - Ngủ tới sáng: tối dần, dậy lúc 7:00. Nếu tàu đang tự lái thì vẫn bay tiếp trong lúc ngủ.
- **Ghế và 2 chỗ lan can** (bấm E): ngồi hoặc tựa để ngắm cảnh.

**Đèn ban đêm:** `world.lamps.add(object, { color, range })`.
- Ánh sáng giả lập bằng shader: vật xung quanh được rọi theo hướng mặt, mờ dần theo khoảng cách.
- Ban ngày tự tắt.
- Mặc định 4 đèn gần camera nhất chiếu cùng lúc, tối đa 8 (chỉnh trong bảng G → Đèn).
- Vật có tick **Phát sáng** + **Chiếu sáng ban đêm** trong add-on Blender tự thành đèn.

**Model từ Blender:** cài add-on `tools/blender/skybase_tools-1.1.0.zip` (hướng dẫn trong `tools/blender/README.md`). Gắn nhãn, bấm Xuất, rồi trong game gọi `loadModel(world, 'models/ten.glb')`.

**Dev cùng AI:** `AGENTS.md` (mọi AI agent) và `CLAUDE.md` (Claude Code) ghi kiến trúc, quy ước và các bẫy đã gặp. AI mở folder này sẽ tự đọc.

## Phím mặc định (`world.handleKeys`)

| Phím | Tác dụng |
|---|---|
| G | Bảng chỉnh hình ảnh |
| C | Đổi mây volumetric ↔ vẽ cọ (nhẹ) |
| B | Bật / tắt bloom |
| ] / [ | Tua thời gian x8, x64 / về x1 |
| M | Tắt tiếng |

Demo thêm các phím riêng:
- **Đi bộ:** W/A/S/D đi, Shift chạy, Space nhảy, Q vẫy tay.
- **Trên boong:** E dùng bánh lái, võng, ghế, lan can; phím số chọn trong menu; Esc đóng menu.
- **Trên tàu:** W/S ga, A/D lái, Space/Shift lên xuống.
- **Chung:** F lên tàu / nhảy khỏi tàu, V đổi camera, H ẩn hướng dẫn.

## Chỉnh ở đâu

Mỗi hệ thống có 1 object cấu hình ở đầu file. Phần lớn chỉnh được trực tiếp trong bảng **G**.

| Thứ cần chỉnh | Object | File |
|---|---|---|
| Màu trời, nắng, mây, sương theo giờ | `ATMOSPHERE` | `engine/sky/palette.ts` |
| Màu đảo, cát, cỏ, vật thể | `COLORS` | `engine/sky/palette.ts` |
| Độ dài ngày, sương, mây ban đêm | `SKY` | `engine/sky/Environment.ts` |
| Mây volumetric (độ phủ, độ cao, hình dáng, hiệu năng) | `VOLUME` | `engine/clouds/VolumetricClouds.ts` |
| Cách tạo khối mây (GPU, 256³) | `CLOUD_GEN` | `engine/clouds/gpuNoise.ts` |
| Nước (màu, gradient, bọt, sóng, bờ) | `WATER` | `engine/water/Ocean.ts` |
| Bloom | `BLOOM` | `engine/render/PostFX.ts` |
| Đèn ban đêm (số đèn cùng lúc, độ sáng, lập loè) | `LAMP_FX` | `engine/render/LampLights.ts` |
| Speed lines | `SPEED_LINES` | `engine/render/SpeedLines.ts` |
| Sợi gió | `WIND_FX` | `engine/fx/WindFX.ts` |
| Vệt khí sau tàu (độ dài, bề rộng, độ đậm, tốc độ hiện) | `TRAIL_FX` | `engine/fx/Trail.ts` |
| Cỏ (tắt mặc định) | `GRASS` | `engine/terrain/Grass.ts` |
| Camera góc 3 (tàu / người) | `THIRD_PERSON` / `CHARACTER_CAMERA` | `engine/camera/CameraRig.ts` |
| Dáng đi, chạy, bơi của nhân vật | `CHARACTER_ANIM` | `engine/character/Character.ts` |
| Tốc độ, nhảy, trọng lực nhân vật | `CHARACTER_MOVE` | `engine/character/CharacterController.ts` |

**Máy chậm**, thử lần lượt:

1. Hạ `VOLUME.resolutionScale` xuống 0.35.
2. Tăng `VOLUME.stepGrowth` / `maxStep`.
3. Hạ `CLOUD_GEN.resolution` xuống 128 (khởi động nhanh hơn).
4. Nếu vẫn chậm, bấm C để dùng mây vẽ cọ.

## Cấu trúc

```
src/
  engine/                 DÙNG LẠI — không chứa logic game
    index.ts              cửa ngõ: import mọi thứ từ '../engine'
    World.ts              gom môi trường + thứ tự render + bảng G mặc định
    core/                 Input (bàn phím theo KeyboardEvent.code, không lỗi Unikey; chuột), math
    camera/CameraRig.ts   camera góc 3 / góc 1, kéo xoay, cuộn zoom, né địa hình
    sky/                  Environment (trời, ngày đêm, sao, trăng, sương), palette
    clouds/               VolumetricClouds (raymarch, temporal, depth prepass), gpuNoise, weather, PaintedClouds
    water/                Ocean (Codrops), shoreline (vá shader địa hình: cát ướt + bọt bờ)
    terrain/              Terrain (đảo từ hàm độ cao), Grass (cỏ Ghibli instanced)
    fx/WindFX.ts          sợi gió Wind Waker
    fx/Trail.ts           vệt khí kéo sau 1 điểm neo (mép khí cầu, đầu cánh…), rõ dần theo tốc độ
    render/               LampLights (đèn giả lập bằng shader, chỉ sáng về đêm), PostFX (HDR + MSAA + bloom), SpeedLines, toon (cel-shading)
    audio/Ambience.ts     tiếng gió + chuông bằng WebAudio
    ui/                   SettingsPanel (lil-gui, tự lưu), Toast
    character/            Character (nhân vật ghép khối + animation thủ tục), CharacterController (đi, chạy, nhảy, bơi)
    assets/loadModel.ts   load .glb từ add-on Blender, tự áp nhãn (toon, bờ sóng, phát sáng, va chạm, điểm mốc)
  demo/                   VÍ DỤ — thay bằng game mới
    main.ts               dùng World + tàu bay + Santorini
    Ship.ts, Cockpit.ts   tàu bay (khớp CameraTarget)
    Santorini.ts          đảo caldera tự dựng (ví dụ addHeightSource + applyShoreline)
    Hud.ts, style.css
public/bluenoise.png      cho mây volumetric (từ leoawen, MIT)
public/models/            model .glb (sample.glb = vật mẫu xuất từ add-on)
tools/blender/            add-on Blender "Skybase Tools" + file .zip để cài
```

Thứ tự render: mây volumetric (nửa độ phân giải) → scene → ghép mây → bloom → speed lines → màn hình.

Debug: khi chạy `npm run dev`, gõ `game` trong console. Ví dụ `game.world.env.time = 0.53` để xem hoàng hôn.

## Giấy phép

- Code Skybase: **MIT** (xem `LICENSE`).
- Add-on Blender trong `tools/blender/`: **GPL-3.0-or-later** (bắt buộc với add-on dùng API của Blender).
- Mã bên thứ ba và văn bản giấy phép gốc: `THIRD_PARTY_LICENSES.md`.

## Ghi công

- Mây volumetric dựa theo [leoawen/volumetric_cloud_atmosphere_scattering](https://github.com/leoawen/volumetric_cloud_atmosphere_scattering) (MIT).
- Nước dựa theo [thaslle/stylized-water](https://github.com/thaslle/stylized-water) và bài Codrops (MIT).
