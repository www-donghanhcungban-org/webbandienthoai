// Node theo dõi các module TypeScript; chỉ phục vụ cây đang sửa trên loopback.

import type { AddressInfo } from "node:net";
import { createDb } from "../src/db.ts";
import { createApp } from "../src/server.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Đặt DATABASE_URL tới PostgreSQL phát triển trước khi chạy pnpm dev");
const port = Number(process.env.PORT ?? 3000);
const server = createApp(createDb(url), { liveAssets: true });
server.listen(port, "127.0.0.1", () => {
  console.log(`Mở http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
});
