# Skybase Tools: add-on Blender

Làm model trong Blender rồi bấm 1 nút là model vào game, đúng tỉ lệ, đúng kiểu toon, có bờ sóng, phát sáng và va chạm. Không cần sửa code three.js.

Chạy trên Blender 4.2 trở lên, đã thử trên **Blender 5.2**.

## Cài

1. Blender → **Edit → Preferences → Get Extensions**.
2. Bấm mũi tên ⌄ góc trên phải → **Install from Disk…** → chọn `skybase_tools-1.1.0.zip`.
3. Ở khung 3D bấm phím **N**, mở tab **Skybase**.

Sửa code add-on xong thì nén lại các file trong `skybase_tools/` (nén các file, không nén cả folder) rồi cài lại.

## Quy trình

1. **Tạo hoặc mở model.** Phần "Tạo nhanh vật mẫu" có sẵn:
   - thước người 1.8 m (để so tỉ lệ, không xuất ra game)
   - đảo nhỏ, nhà mái vòm, cây
   - cột đèn lồng
   - cầu cảng kèm điểm mốc `dock`
   - điểm mốc

   Mỗi vật mẫu đã gắn nhãn và màu sẵn, sửa tiếp từ đó.
2. **Gắn nhãn.** Chọn vật, bấm vai trò (áp cho mọi vật đang chọn):

   | Vai trò | Dùng cho | Game tự làm |
   |---|---|---|
   | **Vật thể** | nhà, cây, đá, đồ vật | đổi sang toon, che mây |
   | **Địa hình** | đảo, đất, núi | như Vật thể, cộng thêm bờ cát ướt, bọt sóng, độ cao cho tàu/camera không xuyên qua |
   | **Điểm mốc** | Empty đánh dấu vị trí | game lấy theo tên: `model.markers.get('dock')` |
   | **Không xuất** | vật tham khảo | bỏ qua |

   Các tick thêm:
   - **Kiểu toon:** đổi vật liệu sang toon (mặc định bật).
   - **Che mây:** mây không vẽ đè lên vật (mặc định bật).
   - **Va chạm:** game nhận hộp va chạm của vật, dùng `model.hit(pos, r)`.
   - **Phát sáng:** đèn, cửa sổ tự sáng và có bloom; chỉnh được độ sáng và màu.
   - **Chiếu sáng ban đêm** (hiện khi tick Phát sáng): ban đêm vật này rọi sáng ra boong, tường, người, mặt nước xung quanh trong bán kính **Tầm chiếu**.
3. **Tô màu palette.** Chọn màu từ bảng màu của game (tường kem, mái xanh, cát, cỏ…) → **Tô màu**. Model dùng chung vật liệu nên nhẹ hơn.
4. **Xem toon** để thấy gần giống trong game (cel-shading 3 mảng). **Tắt** để trở lại vật liệu gốc. Bật hay tắt đều không ảnh hưởng file xuất.
5. **Kiểm tra & xuất:**
   - Chọn **Thư mục game** là folder có `package.json`, ví dụ `claudegame\skybase`.
   - Đặt **Tên file** (để trống thì lấy tên file .blend).
   - Chọn phạm vi xuất: vật đang chọn, vật đang hiện, hoặc collection.
   - **Kiểm tra** báo lỗi theo 3 mức (đỏ = lỗi, phải sửa mới xuất được), bấm biểu tượng con trỏ để chọn đúng vật bị lỗi. Nội dung kiểm tra:
     - đơn vị không phải mét, scale chưa áp, scale âm
     - quá nhiều tam giác cho web
     - texture quá lớn, có texture nhưng mesh thiếu UV
     - nút vật liệu glTF không hiểu
     - kích thước bất thường (model làm theo cm)
   - **Sửa tự động:** đặt đơn vị mét và áp scale.
   - **Xuất sang game:** ghi file `public/models/<tên>.glb` và copy sẵn code load vào clipboard.

## Trong game

```ts
import { loadModel } from '../engine';

const island = await loadModel(world, 'models/ten-file.glb', { position: new THREE.Vector3(300, 0, -400) });
island.markers.get('dock');   // vị trí điểm mốc
island.hit(ship.position, 6); // chạm vật có tick Va chạm?
```

Xem ví dụ trong `src/demo/main.ts`. File `public/models/sample.glb` được xuất bằng chính add-on này từ các vật mẫu.

## Tàu bay mẫu

`models/airship.blend` là tàu bay của demo (2 tầng, buồng lái, bếp, khoang hàng, kho). Mở ra sửa rồi bấm **Xuất sang game** (tên file `airship`).

File này được sinh bởi `models/build_airship.py`. Dựng lại từ đầu (ghi đè cả `.blend` lẫn `.glb`):

```
blender --background --python tools/blender/models/build_airship.py -- <thư mục game>
```

Giữ nguyên tên các node và điểm mốc mà game dùng (xem phần "Tàu bay demo" trong `AGENTS.md`).

## Quy ước

- **1 đơn vị = 1 m.** Dùng thước người 1.8 m để so.
- **Mặt trước của vật hướng +Y** trong Blender. Vào game, hướng này thành hướng Bắc (−Z), tức hướng tàu bay về phía trước.
- **Mặt biển ở Z = 0.** Phần địa hình dưới nước nên chìm sâu hơn khoảng 9 m (đáy biển), nếu không sẽ lộ hình dạng lưới qua làn nước trong.
- **Vật liệu:** chỉ dùng Principled BSDF với màu hoặc texture. Các nút phức tạp (noise, ramp…) glTF không xuất được.
- **Model cho web nên dưới 150.000 tam giác.**
