# Skybase: hướng dẫn cho Claude

Toàn bộ quy tắc, kiến trúc và các bẫy đã gặp nằm trong AGENTS.md (dùng chung cho mọi AI agent):

@AGENTS.md

## Thêm cho Claude

- Người dùng nói tiếng Việt: trả lời bằng tiếng Việt, comment code bằng tiếng Việt.
- Yêu cầu chưa rõ (ví dụ "làm đẹp hơn", "sửa camera") thì **hỏi lại trước khi sửa**, đừng đoán rồi làm.
- Sau mỗi thay đổi: chạy `npm run typecheck`. Đổi shader hoặc hình ảnh thì chạy `npm run dev` và chụp màn hình để tự kiểm tra trước khi báo xong.
- Chụp headless (Playwright + Chromium không có GPU) cần các cờ `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - Bake noise mây mất khoảng 10 giây.
  - Frame chạy chậm nên hiệu ứng theo thời gian (sợi gió, temporal của mây) cần chờ vài giây mới hiện.
  - Debug qua `window.game` (chỉ có ở chế độ dev).
