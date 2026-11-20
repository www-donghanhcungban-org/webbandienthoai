# PROGRESS.md — Điện Thoại Shop

> Giai đoạn hiện tại: G4 Xây dựng (MVP) · Cập nhật: 2026-11-20 · Nhánh: claude/phone-shop-mvp

## Đang làm
- MVP cửa hàng điện thoại đã dựng xong trên nhánh `claude/phone-shop-mvp`: chờ chủ dự án xem thử rồi gộp vào `main`.

## Tiếp theo
1. Chủ shop xem thử (`pnpm migrate up && pnpm seed && pnpm dev`) và cho phản hồi về giao diện, danh mục, chính sách.
2. Thay 12 sản phẩm mẫu bằng danh mục thật ở `/admin` (giá, tồn kho, ảnh https).
3. Thanh toán online (VNPay/MoMo): cần tài khoản merchant của chủ shop — chưa làm (xem README, mục "Việc còn lại").
4. Thông báo đơn mới (email/Zalo), triển khai production + tên miền + HTTPS + sao lưu.
5. Cổng sắp tới: `python3 .xtemplates/scripts/xt.py doctor` (cần CPython 3.15) rồi mở PR vào `main`.

## Quyết định
- 2026-11-20 Cài khung X-Templates 3.34.0 với gói `web-api-ts`; đổi miền ghi chú của starter thành cửa hàng điện thoại — lý do: stack đã kiểm, có RLS/đăng nhập/migration/test sẵn.
- 2026-11-20 Một cửa hàng = một tenant của khung (khách đọc/đặt trong tenant `SHOP_TENANT_ID`, quản trị lấy tenant từ phiên) — lý do: giữ nguyên cô lập dữ liệu đã được test, không viết lại tầng bảo mật; đường lùi: tách thành app một tenant sau này không phá hợp đồng API.
- 2026-11-20 Chỉ COD ở bản đầu — lý do: cổng online cần khoá thật của chủ shop (mặc định tự host, không giả lập khoá).
- 2026-11-20 Thay `contract/baseline.json` bằng hợp đồng mới — lý do: baseline cũ là API ghi chú của starter, chưa phát hành bản nào nên không có client cần giữ tương thích.
- Nợ kỹ thuật chấp nhận: tệp ghi chú của starter (`src/notes-ui.ts`, `src/notes-ui/`, `test/notes-ui.test.ts`) còn nằm lại vì guard chặn xoá — hạn trả: lát kế (xoá bằng commit riêng); giới hạn tần suất trong bộ nhớ — hạn trả: trước khi chạy nhiều bản sao.

## Bàn giao phiên
- Commit cuối trên nhánh chính: chưa có (repo mới, `main` chưa có commit) · CI: chưa chạy
- Lệnh kiểm nhanh: `pnpm lint && pnpm typecheck && pnpm exec vitest run` → exit 0 (56 test) lúc 06:36 UTC
- Đang chặn: không
- Việc dở chưa commit: không
- Câu hỏi cần người: nội dung pháp lý/chính sách bán hàng và thông tin liên hệ cửa hàng — hỏi chủ shop
