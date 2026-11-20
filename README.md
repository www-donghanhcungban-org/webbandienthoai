# Điện Thoại Shop — website bán điện thoại

Cửa hàng điện thoại trực tuyến: khách xem danh mục, lọc, so sánh, bỏ giỏ và đặt hàng **thanh toán khi nhận hàng (COD)**;
chủ cửa hàng quản lý sản phẩm, tồn kho và đơn hàng ở `/admin`. Dựng trên khung [X-Templates](https://github.com/www-donghanhcungban-org/X-Templates)
(gói `web-api-ts`: Node 24 · TypeScript · PostgreSQL · kysely · vitest · biome).

## Chạy thử

Cần Node 24, pnpm 12 và một PostgreSQL (≥ 16) có sẵn.

```bash
pnpm install --frozen-lockfile
export DATABASE_URL=postgres://postgres:matkhau@127.0.0.1:5432/shop
pnpm migrate up
ADMIN_EMAIL=chu@cuahang.vn ADMIN_PASSWORD='mat-khau-dai-it-nhat-12-ky-tu' pnpm seed
pnpm dev            # http://127.0.0.1:3000  (cửa hàng) · /admin (quản trị)
```

`pnpm seed` tạo cửa hàng, tài khoản quản trị (nếu có `ADMIN_EMAIL` + `ADMIN_PASSWORD`, tối thiểu 12 ký tự) và **12 sản phẩm mẫu**.
Giá, tồn kho, thông số của sản phẩm mẫu chỉ để xem thử giao diện — thay bằng danh mục thật ở `/admin`. Chạy lại không nhân đôi dữ liệu.

## Chức năng

| Khách | Quản trị (`/admin`, cần đăng nhập) |
|---|---|
| Danh mục, lọc theo hãng/giá, tìm kiếm, sắp xếp | Thêm/sửa sản phẩm, giá, giá gốc, tồn kho, thông số, ẩn/hiện |
| Trang chi tiết với thông số, giá giảm, tình trạng kho | Danh sách đơn, đổi trạng thái (mới → xác nhận → giao → hoàn tất / huỷ) |
| So sánh tới 3 máy | Huỷ đơn tự hoàn lại tồn kho |
| Giỏ hàng (lưu trên trình duyệt), đặt hàng COD | |
| Tra cứu đơn bằng mã đơn + số điện thoại | |

## Thiết kế và các điều đã chốt

- **Giá luôn lấy từ cơ sở dữ liệu** khi đặt đơn; giá client gửi lên bị bỏ qua.
- **Không bán quá tồn kho**: tồn trừ nguyên tử trong cùng giao dịch với đơn (`UPDATE … WHERE stock >= qty`); đơn nhiều dòng thiếu một dòng thì cả đơn lùi.
- **Cửa hàng một chủ trên nền nhiều tenant của khung**: mọi bảng có `tenant_id` + RLS (ENABLE/FORCE); khách đọc/đặt hàng trong tenant của cửa hàng
  (`SHOP_TENANT_ID`, mặc định tenant tạo sớm nhất); quản trị luôn lấy tenant từ phiên đăng nhập, không từ client.
- **Đặt đơn và tra cứu có giới hạn theo IP** (10 đơn / 10 phút, 30 lần tra cứu / 10 phút) — bộ đếm trong bộ nhớ, đủ cho một tiến trình.
- Tra cứu đơn cần đúng cả mã lẫn số điện thoại; sai một trong hai đều trả 404.
- Giao diện không framework, CSP chặt (`script-src 'self'`, không inline), dữ liệu đưa vào DOM bằng `textContent`.
- Sản phẩm không xoá cứng: ngừng bán = ẩn (`active = false`) để đơn cũ vẫn tra được.
- Hợp đồng API: [`contract/openapi.json`](contract/openapi.json); test chặn thay đổi phá vỡ so với `contract/baseline.json`.

## API

Công khai: `GET /v1/products` (`brand`, `q`, `min`, `max`, `sort=newest|price_asc|price_desc`) · `GET /v1/products/{slug}` ·
`POST /v1/orders` · `POST /v1/orders/lookup`. Quản trị (header `Authorization: Bearer <token>` từ `POST /v1/login`):
`GET|POST /v1/admin/products` · `PUT /v1/admin/products/{id}` · `GET /v1/admin/orders` · `PATCH /v1/admin/orders/{id}`.

## Lệnh

| Việc | Lệnh |
|---|---|
| Kiểm tra mã | `pnpm lint` · `pnpm typecheck` |
| Test (cần `DATABASE_URL` tới Postgres có quyền tạo DB) | `pnpm exec vitest run` |
| Bản dựng tái lập | `pnpm build` → `dist/app.tgz` |
| Cổng của khung | `python3 .xtemplates/scripts/xt.py doctor` (cần CPython 3.15) |

## Việc còn lại (chưa làm, cần quyết định hoặc thông tin của chủ shop)

- **Thanh toán trực tuyến** (VNPay/MoMo/chuyển khoản): cần tài khoản merchant và khoá thật của chủ shop. Hiện chỉ có COD.
- **Ảnh sản phẩm thật**: hiện có ô nhập URL `https://` ở `/admin`; chưa có tải ảnh lên. Khi không có ảnh, giao diện vẽ hình máy theo màu.
- **Thông báo đơn mới** (email/Zalo/SMS): chưa có; chủ shop xem đơn ở `/admin`.
- **Giới hạn tần suất dùng chung** khi chạy nhiều bản sao (hiện trong bộ nhớ từng tiến trình); phía sau proxy cần cấu hình lấy IP thật.
- **Triển khai production, tên miền, HTTPS, sao lưu** — chưa cấu hình; bản dev chạy bằng `ops/dev/compose.yaml` (Docker).
- Pháp lý bán hàng online tại Việt Nam (đăng ký website TMĐT với Bộ Công Thương, chính sách đổi trả/bảo hành, điều khoản, bảo vệ dữ liệu cá nhân của khách
  theo Luật 91/2025/QH15): cần chủ shop xác nhận nội dung trước khi mở bán thật.
- Dọn tệp ghi chú của starter: `src/notes-ui.ts`, `src/notes-ui/`, `test/notes-ui.test.ts` không còn được server dùng (guard khung chặn xoá tự động).
