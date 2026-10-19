# Hướng dẫn cho AI agent: Skybase

File này dành cho AI viết code (Claude, Codex, Cursor, Copilot...). Đọc hết trước khi sửa code. Người dùng đọc `README.md`.

Skybase là **base môi trường 3D phong cách anime** để làm nhiều game khác nhau. Thành phần:
- trời có chu kỳ ngày đêm
- mây volumetric (raymarch)
- biển stylized có bờ sóng
- đảo, cỏ
- sợi gió Wind Waker, speed lines, bloom
- bảng chỉnh thông số trong game

Stack: **Three.js 0.170 (WebGLRenderer, GLSL)**, TypeScript strict, Vite 5, lil-gui. Không dùng React, không dùng WebGPU/TSL. Đừng chuyển sang những thứ đó nếu người dùng không yêu cầu.

## Lệnh

```bash
npm install
npm run dev        # http://localhost:5173 (Windows: bấm đúp start.bat)
npm run typecheck  # tsc --noEmit: BẮT BUỘC chạy sau mỗi lần sửa
npm run build      # typecheck + vite build
```

Không có test tự động. Kiểm tra bằng typecheck/build, rồi chạy game và **nhìn**. Mọi thay đổi về shader hay hình ảnh đều phải được xem bằng mắt (tự chụp màn hình nếu công cụ cho phép, không thì nhờ người dùng chạy thử).

## Cấu trúc và quy tắc ranh giới

```
src/engine/   DÙNG LẠI cho mọi game. Không chứa logic game.
src/demo/     Ví dụ: tàu bay + đảo Santorini + model mẫu từ Blender. Game mới thay folder này.
tools/blender/ Add-on Blender "Skybase Tools" (Python, Blender 4.2+, đã thử 5.2): gắn nhãn, kiểm tra, xuất .glb.
public/models/ Model .glb (add-on xuất vào đây).
```

- **Game mới:** viết trong `src/demo/` (hoặc đổi tên thành `src/game/`, nhớ sửa `<script src>` trong `index.html`). Import engine qua `import { ... } from '../engine'`.
- **Không sửa `src/engine/` cho nhu cầu riêng của một game.** Muốn đổi hành vi thì làm theo thứ tự ưu tiên:
  1. chỉnh object cấu hình (`WATER`, `VOLUME`...) từ code game;
  2. dùng option của `World` hoặc API công khai;
  3. nếu buộc phải sửa engine thì sửa theo hướng **tổng quát** (thêm option hoặc hook, mặc định giữ hành vi cũ) và cập nhật file này lẫn README.
- `src/engine/index.ts` là cửa ngõ. Thêm module engine mới thì export ở đây.
- Engine không được import từ `src/demo/`.

## Luồng chạy

```ts
const world = new World({ container, appId, islands, clearZones });
// thêm vật thể game vào world.scene
// mỗi frame:
world.handleKeys(input);
world.update(dt, { camera, cameraDistance, speed, mode, showWind });
world.render(dt);
input.endFrame();
```

Thứ tự render (trong `World.render` và `PostFX`): mây volumetric (nửa độ phân giải, có depth prepass) → RenderPass scene → ghép mây → UnrealBloom → SpeedLines → OutputPass.

`PostFX.insertAfterScene(pass)` chèn trước bloom. `PostFX.insertBeforeOutput(pass)` chèn sau bloom.

## Quy ước

- **Đơn vị: 1 = 1 mét.** Mặt biển `SEA_LEVEL = 0`. Mây nằm ở độ cao `VOLUME.bottom`–`VOLUME.top` (170–820 m). Sương xa 1–7.5 km. Model sai tỉ lệ sẽ phá cảm giác không gian.
- **Hướng:** `yaw = 0` nhìn về −Z (Bắc). Vector phía trước = `(-sin yaw, 0, -cos yaw)`.
- **Cấu hình:** mỗi hệ thống có 1 object `UPPER_CASE` ở đầu file (`WATER`, `VOLUME`, `SKY`, `BLOOM`, `WIND_FX`, `SPEED_LINES`, `GRASS`, `THIRD_PERSON`, `CLOUD_GEN`). Code đọc lại object này mỗi frame nên chỉnh lúc runtime được. Thêm thông số mới thì thêm vào object và có comment tiếng Việt giải thích.
- **Màu:** hex sRGB trong `engine/sky/palette.ts`. `ATMOSPHERE` là các mốc màu theo độ cao mặt trời, engine tự nội suy giữa các mốc. `COLORS` là màu vật thể. Renderer dùng `NoToneMapping` để giữ đúng màu palette, đừng bật ACES/Filmic.
- **Phong cách vật liệu:** cel-shading. Dùng `toon(color)` hoặc `MeshToonMaterial` với `gradientMap()` (`engine/render/toon.ts`). Vật liệu PBR thường trông lệch tông.
- **Bàn phím:** dùng `KeyboardEvent.code` (`'KeyW'`, `'Space'`...) qua `Input.isDown` và `Input.wasPressed`. **Không dùng `e.key`**, vì bộ gõ tiếng Việt (Unikey) làm sai `key`.
- **Phím đã dùng:** `World.handleKeys` dùng C, G, B, M, `[`, `]`. `CharacterController` dùng W/A/S/D, Shift, Space, Q. Demo dùng thêm E (tương tác), 1–9 + Esc (menu), V (đổi camera), H (camera về mặc định), F1 (ẩn hướng dẫn), F (lên tàu / nhảy khỏi tàu). Tránh trùng.
- **Comment và chuỗi giao diện:** viết bằng tiếng Việt, giữ đúng phong cách sẵn có.

## Bẫy đã gặp (đọc kỹ)

1. **Vật thể phải che được mây:** mây volumetric chỉ biết vật thể nào nằm ở **layer 1**. Mọi mesh đặc (đảo, nhà, tàu, model `.glb`) phải bật layer này:
   ```ts
   obj.traverse((o) => o.layers.enable(1));
   ```
   Quên bước này thì mây vẽ đè lên vật thể, hoặc vật thể "ma" hiện xuyên qua mây.
2. **Shader patch bằng `onBeforeCompile`:** Three.js gom chương trình shader theo `onBeforeCompile.toString()`. Nhiều material dùng chung một hàm bọc thì sẽ **dùng nhầm shader của nhau**. Lỗi này từng làm mất vân tầng đá của Santorini. Luôn đặt khoá riêng:
   ```ts
   mat.customProgramCacheKey = () => '<khoá riêng>';
   ```
   Xem cách làm trong `engine/water/shoreline.ts`.
3. **Bờ biển:** địa hình tự dựng gọi `applyShoreline(material)` để có cát ướt, màu dưới nước và dải bọt theo mực nước nhấp nhô. Gọi trước lần render đầu tiên. Hàm này giữ nguyên `onBeforeCompile` cũ nếu có.
4. **Độ cao địa hình:** địa hình không nằm trong `islands` của `World` phải đăng ký qua `world.terrain.addHeightSource(fn)`, để va chạm và camera biết độ cao. Hai giới hạn:
   - `fn` trả về giá trị rất âm ở chỗ không có đất;
   - cỏ chỉ mọc trên đảo khai báo trong `islands`, trong vùng `HEIGHTMAP` (±2048 m).
5. **Vùng không mây:** `clearZones` gồm tối đa **8** vùng `[x, y, z, bán kính]`, chỉ đặt được lúc tạo `World`.
6. **Z-fighting:**
   - Camera góc 3 dùng `near = 2`, buồng lái dùng `near = 0.3`, `far = 20000`.
   - Mặt nước có `polygonOffset`.
   - Đừng hạ `near` ở góc 3, và đừng đặt mặt phẳng nào trùng `SEA_LEVEL`.
7. **Sương:**
   - Khi bật mây volumetric, đừng giả lập thêm "sương trong mây". Mây đã tự tạo sương thật, cộng thêm sẽ phủ trắng cả cảnh.
   - `World.update` tự điều khiển `scene.fog`, game không ghi đè.
8. **Bloom:** chỉ vùng sáng hơn `BLOOM.threshold` (≈0.93, màu linear) mới toả sáng. Muốn đèn hay cửa sổ toả sáng thì đặt `emissive` và `emissiveIntensity > 1`, đừng hạ ngưỡng toàn cục.
9. **Đèn ban đêm** (`engine/render/LampLights.ts`): không dùng `PointLight`.
   - `World` tự vá mọi vật liệu Toon / Standard / Lambert / Phong trong scene, quét mỗi giây. Phần vá chèn `lampLight()` trước `#include <opaque_fragment>`.
   - `applyLampLight` phải chạy **sau** các bản vá khác: nó chụp lại `customProgramCacheKey` cũ rồi nối thêm `|lamp`. Muốn vá shader mới cho một vật liệu đã nhận đèn thì làm trước khi vật liệu đó vào scene.
   - Tối đa `MAX_LAMPS = 8` đèn trong shader. `LAMP_FX.maxLights` chọn số đèn gần camera nhất được bật.
   - ShaderMaterial tự viết sẽ không nhận đèn.
10. **Sợi gió:** bể cấp sẵn 32 sợi (`MAX_WISPS`), `WIND_FX.wisps` chỉ giới hạn số sợi bay cùng lúc.
11. **Hiệu năng:** mây volumetric là phần nặng nhất. Theo thứ tự ưu tiên:
    - hạ `VOLUME.resolutionScale` (0.35–0.5);
    - tăng `stepGrowth` / `maxStep`;
    - giảm `lightSteps`;
    - hạ `CLOUD_GEN.resolution` xuống 128 cho khởi động nhanh (noise được bake trên GPU lúc khởi động).
    Phím C đổi sang mây vẽ cọ, nhẹ hơn nhiều.
12. **Đổi camera:** `World.setCamera` dựng lại hậu kỳ khi nhận camera khác. Dùng **một** `PerspectiveCamera` cố định rồi đổi vị trí, đừng tạo camera mới mỗi frame.

## Thêm thứ thường gặp

- **Nhân vật đi bộ:** `loadCharacter(world, url, { height })` (`engine/character/Character.ts`) cộng `new CharacterController(world, character, { colliders })`, mỗi frame gọi `controller.update(dt, input, cam)` rồi `cam.update(dt, controller, input)`. Nhớ đặt `cam.profile = CHARACTER_CAMERA`, vì camera mặc định tính cho tàu dài 20 m.
  - **Animation là thủ tục, không dùng skeleton.** Code xoay từng bộ phận theo tên node: `head`, `hair`, `torso`/`body`, `belt`, `arm`, `leg`. Pivot của mỗi node phải nằm ở khớp. Model ghép khối mới chỉ cần đặt tên node như vậy là chạy.
  - Model có skeleton và clip animation thật thì dùng `THREE.AnimationMixer`, đừng nhồi vào `Character`.
  - **Chỉnh:** dáng đi ở `CHARACTER_ANIM`, cảm giác điều khiển ở `CHARACTER_MOVE`.
  - **Mặt đất và va chạm:**
    - đứng được trên địa hình (`world.terrain.heightAt`) và trên mặt trên của hộp va chạm thấp (cầu cảng);
    - bị chặn bởi hộp cao và vách dốc;
    - nước sâu thì tự bơi (mực nước nhấp nhô theo `waterShared`).
  - **Sàn di chuyển** (boong tàu, bè, thang máy): `controller.board(platform, localPos)`.
    - `Platform` gồm `object` (nhân vật thành con của nó), `floorAt(x, z, footY)` (trả null ngoài mép, tức bị chặn) và `colliders`. Tất cả tính theo toạ độ của object.
    - Sàn nhiều tầng (boong + khoang dưới + cầu thang): `floorAt` dùng `footY` (độ cao chân) để trả tầng cao nhất không vượt quá `footY + bậc`. Ví dụ: `src/demo/ShipDeck.ts`.
    - `leavePlatform()` để rời sàn.
    - Camera phải nhận `controller.cameraTarget`, vì `controller.position` là toạ độ cục bộ khi đang trên sàn.
  - **Tư thế:** `controller.setPose('sit' | 'lie' | 'lean' | 'helm', at, yaw)`, `setPose(null, standAt)` để đứng dậy. Game tự đặt chỗ.
  - **Camera:** `cam.autoOrbit` (radian/giây) cho camera tự lượn khi ngủ hoặc cắt cảnh. `cam.reset()` về góc mặc định (sau lưng).
    - `profile.followRate = 0`: camera không tự xoay theo hướng nhân vật. `profile.idleReturn` (giây, 0 = không bao giờ): thả chuột bao lâu thì tự về góc mặc định. Demo đặt cả hai về 0.
    - `CameraTarget.frameYaw` (controller.cameraTarget tự có khi đứng trên sàn): camera xoay theo sàn, nên góc nhìn so với boong giữ nguyên khi tàu rẽ.
  - **Ví dụ gameplay trên tàu:** `src/demo/main.ts` (vòng trạng thái free/helm/pose/nap/sleep), `ShipDeck.ts`, `Autopilot.ts`.
- **Tàu bay demo** là model `public/models/airship.glb`, sinh bằng script `tools/blender/models/build_airship.py` (file sửa tay: `airship.blend`). Muốn đổi hình tàu thì sửa script rồi chạy lại (lệnh ở đầu file), hoặc sửa `.blend` rồi xuất bằng add-on. Game dựa vào các quy ước sau, đổi model phải giữ:
  - tên node cử động: `wheel`, `needle`, `prop_L`, `prop_R`, `flag_dome`, `flag_bow`;
  - điểm mốc: `spot_*` (chỗ tương tác, thuộc tính `sb_yaw` = hướng), `stand_*` (chỗ đứng dậy), `board`, `eye_helm`, `trail_*`;
  - thuộc tính `sb_hide` (`upper`, `roof_wheel`, `roof_kitchen`) để cắt mái khi nhân vật vào trong;
  - scene extras `sb_layout` (JSON: mặt cắt thân, sàn tầng dưới, cầu thang, các phòng) mà `ShipDeck.ts` đọc để dựng sàn đi được.

- **Nhân vật hoặc phương tiện bám camera:** cho object khớp interface `CameraTarget` (`position`, `yaw`, `speed`, `eye`, `body`; xem `demo/Ship.ts`), rồi gọi `cam.update(dt, target, input)`. Game không cần camera này thì truyền `PerspectiveCamera` riêng vào `world.update`.
- **Model `.glb` từ Blender:** dùng add-on `tools/blender/` (xem README trong đó). Load bằng `loadModel(world, 'models/x.glb', { position })` (`engine/assets/loadModel.ts`). Hàm này đọc nhãn glTF extras (`sb_role`, `sb_toon`, `sb_clouds`, `sb_collide`, `sb_glow`, `sb_glow_color`, `sb_light`) và tự làm:
  - đổi vật liệu sang toon;
  - bật layer 1;
  - với địa hình: gọi `applyShoreline` và đăng ký độ cao;
  - với vật phát sáng: đặt emissive, và nếu có `sb_light` thì đăng ký đèn ban đêm với `world.lamps`;
  - trả về `markers`, `colliders`, `hit()`, `heightAt`.
  Đừng tự viết lại `GLTFLoader` thủ công, trừ khi model không đến từ add-on (khi đó tự làm đủ: tỉ lệ mét, toon, layer 1, shoreline/heightSource). **Add-on và `loadModel` dùng chung định dạng nhãn**, đổi bên này phải đổi bên kia.
- **Thông số mới cho bảng G:**
  ```ts
  world.panel?.section('Tên hiển thị', 'TEN_OBJECT', CFG, (f) => {
    f.add(CFG, 'x', 0, 10, 0.1).name('Nhãn tiếng Việt');
  }, /* mở sẵn */ false);
  ```
  Bảng chỉ lưu giá trị số, chuỗi, bool vào localStorage với khoá `${appId}-${tenobject}`. Vector3 và mảng không được lưu.
- **Hiệu ứng nước** (`engine/fx/Wake.ts`): `wake.foam(x, z, vx, vz, r0, r1)` mảng bọt, `wake.ring(x, z, r0, r1)` gợn tròn, `wake.spray(pos, vel, size)` tia nước; mỗi frame `wake.update(dt, camera, viewportHeight)`. Hạt nằm theo `waterLevelNow()` (mực nước nhấp nhô, export từ `water/Ocean.ts`). Ví dụ chọn chỗ sinh hạt theo thân tàu: `src/demo/ShipWater.ts`. Vẽ sau mặt nước (`renderOrder` > 2), đừng hạ xuống.
- **Pass hậu kỳ mới:** viết dạng `ShaderPass`, chèn bằng `PostFX.insertAfterScene` hoặc `insertBeforeOutput`. Mẫu: `engine/render/SpeedLines.ts`.
- **Đảo trên biển:** thêm 1 dòng `{ x, z, radius, height, seed }` vào `islands` của `World`.

## Bản quyền

Mây dựa theo leoawen/volumetric_cloud_atmosphere_scattering (MIT). `public/bluenoise.png` cũng lấy từ repo này. Nước dựa theo thaslle/stylized-water (MIT). Giữ phần ghi công trong comment đầu file và trong README.
