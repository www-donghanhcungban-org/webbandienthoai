import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

// Chỉ phục vụ ba tài sản có trong bản dựng. Đường dẫn từ trình duyệt không được dùng làm đường dẫn tệp.
const entries = [
  ["/", "index.html", "text/html"],
  ["/notes.css", "app.css", "text/css"],
  ["/notes.js", "app.js", "text/javascript"],
] as const;
const assets = new Map<string, { source: URL; content: Buffer; mime: string }>(
  entries.map(([path, file, mime]) => {
    const source = new URL(`./notes-ui/${file}`, import.meta.url);
    return [path, { source, content: readFileSync(source), mime }];
  }),
);

export function serveNotesUi(
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
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(method === "HEAD" ? undefined : content);
  return true;
}
