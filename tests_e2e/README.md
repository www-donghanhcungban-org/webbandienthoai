---
title: Kiểm thử bản dev của dự án bằng trình duyệt
kind: index
updated: 2026-11-19
---

# Kiểm thử bản dev

Từ gốc repo với mã đã commit, chạy lệnh sau trên Linux x86_64 có CPython 3.15, Node 24 và Docker Compose v2. Lần đầu cần mạng để tải phụ thuộc, Chromium và image. Cổng 4317 trên loopback cần trống hoặc thuộc bản dev hiện tại của dự án.

```bash
bash tests_e2e/preview.sh
```

Lệnh tạo venv tạm, dựng artifact, triển khai ứng dụng và PostgreSQL, rồi mở Chromium. Bài kiểm trong `tests_e2e/pack_preview.py` đăng nhập, tạo ghi chú và đọc lại đúng ID qua một phiên trình duyệt mới. Khi đạt, kết quả nằm ở `dist/preview-browser.json`, kèm digest để đối chiếu với `docs/ops/DEPLOYS.json`. Tham số `--output FILE` đổi nơi lưu. Khi chạy lại, lệnh lưu bản kết quả trước ở file có đuôi `.previous.*`.

Mở <http://127.0.0.1:4317/> sau khi kiểm thử để dùng bản dev. Chạy `node scripts/dev-preview.mjs credentials` ở terminal riêng để xem tài khoản và `node scripts/dev-preview.mjs stop` để dừng dịch vụ.

Workflow `.github/workflows/dev-preview.yml` gọi cùng lệnh trên pull request và cho phép chạy thủ công bằng **Actions → dev-preview → Run workflow**. Artifact `dev-preview-evidence` chứa kết quả browser và receipt. Để chỉ chạy thủ công, bỏ sự kiện `pull_request` trong workflow của dự án.
