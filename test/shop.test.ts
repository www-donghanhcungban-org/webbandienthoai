// Nghiệp vụ cửa hàng: lọc danh mục, đặt đơn COD (giá từ DB, trừ kho nguyên tử), huỷ đơn hoàn kho, tra cứu, giao diện, seed.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { RateLimit, slugify } from "../src/shop.ts";
import {
  call,
  dbUrl,
  dropDatabase,
  freshDatabase,
  loginAs,
  seedTenant,
  serve,
  type Tenant,
} from "./helpers.ts";

let db: Db;
let name: string;
let base: string;
let close: () => Promise<void>;
let shop: Tenant;
let token: string;

const PHONE = "0912 345 678";

async function addProduct(body: Record<string, unknown>): Promise<{ id: string; slug: string }> {
  const r = await call(
    base,
    "POST",
    "/v1/admin/products",
    { brand: "Apple", price: 1000, stock: 5, ...body },
    token,
  );
  expect(r.status).toBe(201);
  return r.json as { id: string; slug: string };
}

const order = (items: { product_id: string; qty: number }[], extra: Record<string, unknown> = {}) => ({
  customer_name: "Nguyễn Văn A",
  phone: PHONE,
  address: "12 Lê Lợi, Quận 1",
  items,
  ...extra,
});

beforeAll(async () => {
  ({ db, name } = await freshDatabase());
  shop = await seedTenant(db, "shop");
  ({ base, close } = await serve(db, { shopTenantId: shop.id, orderLimit: { max: 1000, windowMs: 60_000 } }));
  token = await loginAs(base, shop);
});

afterAll(async () => {
  await close();
  await dropDatabase(db, name);
});

describe("danh mục công khai", () => {
  it("lọc theo hãng, giá, từ khoá; sắp xếp; chỉ hiện sản phẩm đang bán", async () => {
    await addProduct({ name: "iPhone Alpha", brand: "Apple", price: 30_000_000 });
    await addProduct({ name: "Galaxy Beta", brand: "Samsung", price: 10_000_000 });
    await addProduct({ name: "Galaxy Gamma 100%", brand: "Samsung", price: 5_000_000 });
    await addProduct({ name: "Máy ẩn", brand: "Samsung", price: 1, active: false });

    const names = async (q: string) =>
      ((await call(base, "GET", `/v1/products${q}`)).json.products as { name: string }[]).map((p) => p.name);
    expect(await names("?brand=Samsung&sort=price_asc")).toEqual(["Galaxy Gamma 100%", "Galaxy Beta"]);
    expect(await names("?sort=price_desc")).toEqual(["iPhone Alpha", "Galaxy Beta", "Galaxy Gamma 100%"]);
    expect(await names("?min=6000000&max=20000000")).toEqual(["Galaxy Beta"]);
    expect(await names("?q=gamma")).toEqual(["Galaxy Gamma 100%"]);
    expect(await names("?q=%25")).toEqual(["Galaxy Gamma 100%"]); // % là ký tự thường, không phải wildcard
    expect(await names("?q=_")).toEqual([]);
    expect((await call(base, "GET", "/v1/products?min=abc")).status).toBe(422);
    expect((await call(base, "GET", "/v1/products?sort=x")).status).toBe(422);
  });

  it("chi tiết theo slug (tự sinh từ tên, bỏ dấu); sản phẩm ẩn là 404", async () => {
    const p = await addProduct({ name: "Điện thoại Đẹp Số 1" });
    expect(p.slug).toBe("dien-thoai-dep-so-1");
    expect((await call(base, "GET", `/v1/products/${p.slug}`)).json.name).toBe("Điện thoại Đẹp Số 1");
    expect((await call(base, "GET", "/v1/products/may-an")).status).toBe(404);
    expect((await call(base, "GET", "/v1/products/KHÔNG-CÓ")).status).toBe(404);
  });

  it("đầu vào sản phẩm sai bị từ chối", async () => {
    const bad = async (extra: Record<string, unknown>) =>
      (await call(base, "POST", "/v1/admin/products", { name: "Z", brand: "Z", price: 10, ...extra }, token))
        .json;
    expect(await bad({ price: -1 })).toEqual({ error: "invalid_price" });
    expect(await bad({ price: 1.5 })).toEqual({ error: "invalid_price" });
    expect(await bad({ old_price: 5 })).toEqual({ error: "invalid_old_price" });
    expect(await bad({ color: "red" })).toEqual({ error: "invalid_color" });
    expect(await bad({ image_url: "http://x/y.png" })).toEqual({ error: "invalid_image_url" });
    expect(await bad({ slug: "Có Dấu" })).toEqual({ error: "invalid_slug" });
    expect(await bad({ specs: ["a"] })).toEqual({ error: "invalid_specs" });
    expect(await bad({ specs: { a: 1 } })).toEqual({ error: "invalid_specs" });
    expect(await bad({ stock: -3 })).toEqual({ error: "invalid_stock" });
    expect(await bad({ active: "yes" })).toEqual({ error: "invalid_active" });
  });
});

describe("đặt hàng", () => {
  it("giá lấy từ DB, không tin client; trừ kho; gộp dòng trùng; mã đơn 8 ký tự", async () => {
    const p = await addProduct({ name: "Máy giá thật", price: 7_000_000, stock: 5 });
    const r = await call(base, "POST", "/v1/orders", {
      ...order([
        { product_id: p.id, qty: 1 },
        { product_id: p.id, qty: 1 },
      ]),
      items: [
        { product_id: p.id, qty: 1, price: 1 },
        { product_id: p.id, qty: 1, unit_price: 1 },
      ], // giá client bị bỏ qua
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ total: 14_000_000, status: "new" });
    expect(String(r.json.code)).toMatch(/^[A-Z2-9]{8}$/);
    const left = (await call(base, "GET", `/v1/products/${p.slug}`)).json.stock;
    expect(left).toBe(3);
  });

  it("không bán quá tồn kho: 5 đơn cùng lúc cho 2 máy → đúng 2 đơn thành công, tồn về 0, không âm", async () => {
    const p = await addProduct({ name: "Máy hiếm", price: 1_000_000, stock: 2 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(base, "POST", "/v1/orders", order([{ product_id: p.id, qty: 1 }])),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.json.error === "out_of_stock")).toBe(true);
    expect((await call(base, "GET", `/v1/products/${p.slug}`)).json.stock).toBe(0);
  });

  it("đơn nhiều dòng mà một dòng hết hàng → cả đơn lùi, dòng kia không bị trừ kho", async () => {
    const ok = await addProduct({ name: "Máy đủ hàng", stock: 4 });
    const none = await addProduct({ name: "Máy hết hàng", stock: 0 });
    const r = await call(
      base,
      "POST",
      "/v1/orders",
      order([
        { product_id: ok.id, qty: 2 },
        { product_id: none.id, qty: 1 },
      ]),
    );
    expect(r.status).toBe(409);
    expect((await call(base, "GET", `/v1/products/${ok.slug}`)).json.stock).toBe(4);
  });

  it("sản phẩm ẩn hoặc không tồn tại không đặt được", async () => {
    const hidden = await addProduct({ name: "Máy ngừng bán", active: false, stock: 9 });
    expect((await call(base, "POST", "/v1/orders", order([{ product_id: hidden.id, qty: 1 }]))).status).toBe(
      409,
    );
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await call(base, "POST", "/v1/orders", order([{ product_id: ghost, qty: 1 }]))).status).toBe(409);
  });

  it("đầu vào đơn sai bị từ chối trước khi chạm DB", async () => {
    const p = await addProduct({ name: "Máy kiểm đầu vào", stock: 50 });
    const line = { product_id: p.id, qty: 1 };
    const err = async (body: Record<string, unknown>) => (await call(base, "POST", "/v1/orders", body)).json;
    expect(await err(order([line], { phone: "12345" }))).toEqual({ error: "invalid_phone" });
    expect(await err(order([line], { customer_name: "  " }))).toEqual({ error: "invalid_customer_name" });
    expect(await err(order([line], { address: "" }))).toEqual({ error: "invalid_address" });
    expect(await err(order([]))).toEqual({ error: "invalid_items" });
    expect(await err(order([{ product_id: "x", qty: 1 }]))).toEqual({ error: "invalid_items" });
    expect(await err(order([{ product_id: p.id, qty: 0 }]))).toEqual({ error: "invalid_items" });
    expect(
      await err(
        order([
          { product_id: p.id, qty: 6 },
          { product_id: p.id, qty: 6 },
        ]),
      ),
    ).toEqual({ error: "invalid_items" });
    expect(await err(order(Array.from({ length: 21 }, () => line)))).toEqual({ error: "invalid_items" });
    expect((await call(base, "GET", `/v1/products/${p.slug}`)).json.stock).toBe(50); // không đơn sai nào trừ kho
    const intl = await call(base, "POST", "/v1/orders", order([line], { phone: "+84 912-345-678" }));
    expect(intl.status).toBe(201); // +84 và dấu cách/gạch nối được chấp nhận
  });

  it("tra cứu cần đúng mã và đúng số điện thoại; sai một trong hai đều 404", async () => {
    const p = await addProduct({ name: "Máy tra cứu", price: 2_000_000 });
    const placed = await call(base, "POST", "/v1/orders", order([{ product_id: p.id, qty: 2 }]));
    const code = String(placed.json.code);
    const ok = await call(base, "POST", "/v1/orders/lookup", {
      code: code.toLowerCase(),
      phone: "0912345678",
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      code,
      status: "new",
      total: 4_000_000,
      items: [{ name: "Máy tra cứu", unit_price: 2_000_000, qty: 2 }],
    });
    expect(ok.json).not.toHaveProperty("phone");
    expect((await call(base, "POST", "/v1/orders/lookup", { code, phone: "0987654321" })).status).toBe(404);
    expect(
      (await call(base, "POST", "/v1/orders/lookup", { code: "AAAAAAAA", phone: "0912345678" })).status,
    ).toBe(404);
  });
});

describe("quản trị đơn hàng", () => {
  it("cần đăng nhập; huỷ đơn hoàn tồn kho đúng một lần; đơn đã huỷ không mở lại", async () => {
    const p = await addProduct({ name: "Máy huỷ đơn", stock: 3 });
    const placed = await call(base, "POST", "/v1/orders", order([{ product_id: p.id, qty: 2 }]));
    const list = (await call(base, "GET", "/v1/admin/orders", undefined, token)).json.orders as {
      id: string;
      code: string;
      phone: string;
    }[];
    const mine = list.find((o) => o.code === placed.json.code);
    expect(mine?.phone).toBe("0912345678"); // số điện thoại được chuẩn hoá khi lưu
    const id = String(mine?.id);
    expect((await call(base, "GET", "/v1/admin/orders")).status).toBe(401);
    expect((await call(base, "PATCH", `/v1/admin/orders/${id}`, { status: "done" })).status).toBe(401);
    expect((await call(base, "GET", `/v1/products/${p.slug}`)).json.stock).toBe(1);

    expect(
      (await call(base, "PATCH", `/v1/admin/orders/${id}`, { status: "confirmed" }, token)).json,
    ).toEqual({ id, status: "confirmed" });
    expect((await call(base, "PATCH", `/v1/admin/orders/${id}`, { status: "cancelled" }, token)).status).toBe(
      200,
    );
    expect((await call(base, "GET", `/v1/products/${p.slug}`)).json.stock).toBe(3);
    expect((await call(base, "PATCH", `/v1/admin/orders/${id}`, { status: "cancelled" }, token)).status).toBe(
      200,
    ); // lặp: không hoàn thêm
    expect((await call(base, "GET", `/v1/products/${p.slug}`)).json.stock).toBe(3);
    expect(await call(base, "PATCH", `/v1/admin/orders/${id}`, { status: "new" }, token)).toEqual({
      status: 409,
      json: { error: "order_closed" },
    });
  });

  it("cập nhật sản phẩm có hiệu lực ở danh mục công khai", async () => {
    const p = await addProduct({ name: "Máy đổi giá", price: 100 });
    const put = await call(
      base,
      "PUT",
      `/v1/admin/products/${p.id}`,
      { name: "Máy đổi giá", slug: p.slug, brand: "Apple", price: 80, old_price: 100, stock: 1 },
      token,
    );
    expect(put.status).toBe(200);
    expect(await call(base, "GET", `/v1/products/${p.slug}`)).toMatchObject({
      status: 200,
      json: { price: 80, old_price: 100 },
    });
  });
});

describe("giao diện", () => {
  it("phục vụ trang cửa hàng, trang quản trị và tài sản với CSP chặt", async () => {
    for (const [path, type] of [
      ["/", "text/html"],
      ["/admin", "text/html"],
      ["/shop.css", "text/css"],
      ["/shop.js", "text/javascript"],
      ["/admin.js", "text/javascript"],
    ] as const) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(type);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("unsafe-inline");
      await res.arrayBuffer();
    }
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("<title>Điện Thoại Shop");
    expect((await fetch(`${base}/notes.js`)).status).toBe(404);
  });

  it("không có inline script/style và không dùng innerHTML với dữ liệu", async () => {
    for (const file of ["/", "/admin", "/shop.js", "/admin.js"]) {
      const text = await (await fetch(base + file)).text();
      expect(text).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
      if (file === "/" || file === "/admin")
        expect(text).not.toMatch(/<script(?![^>]*\bsrc=)|\sstyle=|\sonclick=/);
    }
  });
});

describe("hạ tầng nhỏ", () => {
  it("RateLimit: quá ngưỡng thì chặn, hết cửa sổ thì cho lại, mỗi khoá độc lập", () => {
    const rl = new RateLimit(2, 1000);
    expect([rl.allow("a", 0), rl.allow("a", 1), rl.allow("a", 2)]).toEqual([true, true, false]);
    expect(rl.allow("b", 3)).toBe(true);
    expect(rl.allow("a", 1001)).toBe(true); // lần đầu đã trôi khỏi cửa sổ
    expect(rl.allow("a", 1002)).toBe(true);
    expect(rl.allow("a", 1003)).toBe(false);
  });

  it("đặt đơn quá giới hạn IP → 429 kèm retry-after", async () => {
    const tight = await serve(db, { shopTenantId: shop.id, orderLimit: { max: 1, windowMs: 60_000 } });
    try {
      const body = order([{ product_id: "00000000-0000-4000-8000-000000000000", qty: 1 }]);
      expect((await call(tight.base, "POST", "/v1/orders", body)).status).toBe(409);
      const res = await fetch(`${tight.base}/v1/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
      await res.arrayBuffer();
    } finally {
      await tight.close();
    }
  });

  it("slugify bỏ dấu tiếng Việt, đ → d, gọn dấu gạch", () => {
    expect(slugify("  iPhone 16 Pro — 256GB! ")).toBe("iphone-16-pro-256gb");
    expect(slugify("Điện thoại Đẹp")).toBe("dien-thoai-dep");
    expect(slugify("---")).toBe("");
  });

  it("chưa có cửa hàng (chưa seed) → 503 shop_not_ready, có rồi dùng được ngay", async () => {
    const empty = await freshDatabase();
    const s = await serve(empty.db);
    try {
      expect(await call(s.base, "GET", "/v1/products")).toEqual({
        status: 503,
        json: { error: "shop_not_ready" },
      });
      await seedTenant(empty.db, "late");
      expect((await call(s.base, "GET", "/v1/products")).status).toBe(200);
    } finally {
      await s.close();
      await dropDatabase(empty.db, empty.name);
    }
  });
});

describe("seed", () => {
  it("tạo cửa hàng, quản trị và 12 sản phẩm mẫu; chạy lại không nhân đôi; mật khẩu ngắn bị từ chối", async () => {
    const scratch = await freshDatabase();
    const env = {
      ...process.env,
      DATABASE_URL: dbUrl(scratch.name),
      ADMIN_EMAIL: "chu@example.test",
      ADMIN_PASSWORD: "mat-khau-du-dai-123",
    };
    try {
      const run = (e: NodeJS.ProcessEnv) =>
        execFileSync("node", ["scripts/seed-shop.ts"], { env: e, encoding: "utf8" });
      expect(run(env)).toContain("đã thêm 12 sản phẩm mẫu");
      expect(run(env)).toContain("đã thêm 0 sản phẩm mẫu");
      const s = await serve(scratch.db);
      try {
        const list = (await call(s.base, "GET", "/v1/products")).json.products as unknown[];
        expect(list).toHaveLength(12);
        const login = await call(s.base, "POST", "/v1/login", {
          email: "chu@example.test",
          password: "mat-khau-du-dai-123",
        });
        expect(login.status).toBe(200);
      } finally {
        await s.close();
      }
      expect(() => run({ ...env, ADMIN_EMAIL: "x@example.test", ADMIN_PASSWORD: "ngan" })).toThrow();
    } finally {
      await dropDatabase(scratch.db, scratch.name);
    }
  });
});
