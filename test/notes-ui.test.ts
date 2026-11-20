import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { serveNotesUi } from "../src/notes-ui.ts";

vi.mock("node:fs", { spy: true });

it("chỉ phiên phát triển đọc lại tài sản sau khi lưu", async () => {
  const server = createServer((req, res) => {
    serveNotesUi(req.method, "/notes.css", res, req.url === "/live");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const saved = Buffer.from("/* phiên bản vừa lưu */");
  try {
    const before = await (await fetch(url)).text();
    vi.mocked(readFileSync).mockReturnValueOnce(saved);
    const live = await fetch(`${url}/live`);
    expect(live.headers.get("content-length")).toBe(String(saved.length));
    expect(await live.text()).toBe(saved.toString());
    expect(await (await fetch(url)).text()).toBe(before);
  } finally {
    vi.mocked(readFileSync).mockReset();
    await new Promise<void>((closed) => server.close(() => closed()));
  }
});
