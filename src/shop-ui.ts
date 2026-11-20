import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

// Chỉ phục vụ các tài sản có trong bản dựng. Đường dẫn từ trình duyệt không được dùng làm đường dẫn tệp.
const entries = [
  ["/", "index.html", "text/html"],
  ["/admin", "admin.html", "text/html"],
  ["/shop.css", "shop.css", "text/css"],
  ["/shop.js", "shop.js", "text/javascript"],
  ["/admin.js", "admin.js", "text/javascript"],
] as const;
const assets = new Map<string, { source: URL; content: Buffer; mime: string }>(
  entries.map(([path, file, mime]) => {
    const source = new URL(`./shop-ui/${file}`, import.meta.url);
    return [path, { source, content: readFileSync(source), mime }];
  }),
);

export function serveShopUi(
  method: string | undefined,
  path: string,
  res: ServerResponse,
  live = false,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const asset = assets.get(path);
  if (!asset) return false;
  const content = live ? readFileSync(asset.source) : asset.content;
  res.writeHead(200, {
    "content-type": `${asset.mime}; charset=utf-8`,
    "content-length": content.length,
    "cache-control": "no-store",
    // Ảnh sản phẩm do quản trị nhập là URL https (CHECK ở DB); không cho nguồn script/style ngoài.
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(method === "HEAD" ? undefined : content);
  return true;
}
