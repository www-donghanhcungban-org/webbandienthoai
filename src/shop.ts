// Nghiệp vụ cửa hàng: danh mục, đơn hàng (COD), quản trị. Giá luôn lấy từ cơ sở dữ liệu — không tin giá client gửi.
// Mọi truy vấn đi qua `withTenant` (RLS). Tồn kho trừ nguyên tử bằng UPDATE có điều kiện nên không bán quá số có.
import { randomBytes } from "node:crypto";
import { type Db, UUID_RE, withTenant } from "./db.ts";
import { HttpError } from "./errors.ts";

export const ORDER_STATUSES = ["new", "confirmed", "shipping", "done", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const SORTS = ["newest", "price_asc", "price_desc"] as const;
type Sort = (typeof SORTS)[number];

const PUBLIC_COLS = [
  "id",
  "slug",
  "name",
  "brand",
  "price",
  "old_price",
  "stock",
  "color",
  "image_url",
  "summary",
  "specs",
] as const;
const ADMIN_COLS = [...PUBLIC_COLS, "active", "created_at"] as const;
const PHONE_RE = /^(0|\+84)\d{9,10}$/;
const MAX_MONEY = 2_000_000_000; // cột integer của Postgres; tổng đơn vượt thì từ chối thay vì tràn
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ I, O, 0, 1 cho dễ đọc qua điện thoại

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function str(v: unknown, key: string, max: number, min = 1): string {
  if (typeof v !== "string") throw new HttpError(422, `invalid_${key}`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new HttpError(422, `invalid_${key}`);
  return t;
}

function int(v: unknown, key: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new HttpError(422, `invalid_${key}`);
  }
  return v;
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");
}

// ---------- Danh mục (công khai) ----------

export interface ProductFilter {
  brand?: string;
  q?: string;
  min?: number;
  max?: number;
  sort: Sort;
}

export function parseFilter(params: URLSearchParams): ProductFilter {
  const sort = (params.get("sort") ?? "newest") as Sort;
  if (!SORTS.includes(sort)) throw new HttpError(422, "invalid_sort");
  const f: ProductFilter = { sort };
  const brand = params.get("brand");
  if (brand) f.brand = str(brand, "brand", 60);
  const q = params.get("q");
  if (q) f.q = str(q, "q", 100);
  for (const key of ["min", "max"] as const) {
    const raw = params.get(key);
    if (raw) {
      if (!/^\d{1,10}$/.test(raw)) throw new HttpError(422, `invalid_${key}`);
      f[key] = Math.min(Number(raw), MAX_MONEY);
    }
  }
  return f;
}

export async function listProducts(db: Db, tenantId: string, f: ProductFilter, admin = false) {
  return withTenant(db, tenantId, (tx) => {
    let query = admin
      ? tx.selectFrom("products").select(ADMIN_COLS)
      : tx.selectFrom("products").select(PUBLIC_COLS);
    if (!admin) query = query.where("active", "=", true);
    if (f.brand) query = query.where("brand", "=", f.brand);
    if (f.min !== undefined) query = query.where("price", ">=", f.min);
    if (f.max !== undefined) query = query.where("price", "<=", f.max);
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
      query = query.where((eb) => eb.or([eb("name", "ilike", like), eb("brand", "ilike", like)]));
    }
    if (f.sort === "price_asc") query = query.orderBy("price", "asc");
    else if (f.sort === "price_desc") query = query.orderBy("price", "desc");
    else query = query.orderBy("created_at", "desc");
    return query.orderBy("id").limit(100).execute();
  });
}

export async function getProductBySlug(db: Db, tenantId: string, slug: string) {
  const row = await withTenant(db, tenantId, (tx) =>
    tx
      .selectFrom("products")
      .select(PUBLIC_COLS)
      .where("slug", "=", slug)
      .where("active", "=", true)
      .executeTakeFirst(),
  );
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

// ---------- Quản trị sản phẩm ----------

export interface ProductInput {
  slug: string;
  name: string;
  brand: string;
  price: number;
  old_price: number | null;
  stock: number;
  color: string;
  image_url: string | null;
  summary: string;
  specs: Record<string, string>;
  active: boolean;
}

export function parseProduct(body: Record<string, unknown>): ProductInput {
  const name = str(body.name, "name", 200);
  const price = int(body.price, "price", 0, MAX_MONEY);
  const oldPrice =
    body.old_price === undefined || body.old_price === null
      ? null
      : int(body.old_price, "old_price", 0, MAX_MONEY);
  if (oldPrice !== null && oldPrice < price) throw new HttpError(422, "invalid_old_price");
  const slug = body.slug === undefined ? slugify(name) : str(body.slug, "slug", 120);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new HttpError(422, "invalid_slug");
  const color = body.color === undefined ? "#334155" : str(body.color, "color", 7, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(422, "invalid_color");
  let image: string | null = null;
  if (body.image_url !== undefined && body.image_url !== null && body.image_url !== "") {
    image = str(body.image_url, "image_url", 500);
    if (!image.startsWith("https://")) throw new HttpError(422, "invalid_image_url");
  }
  const specs: Record<string, string> = {};
  if (body.specs !== undefined) {
    const raw = body.specs;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HttpError(422, "invalid_specs");
    const entries = Object.entries(raw);
    if (entries.length > 20) throw new HttpError(422, "invalid_specs");
    for (const [k, v] of entries) specs[str(k, "specs", 40)] = str(v, "specs", 200);
  }
  if (body.active !== undefined && typeof body.active !== "boolean")
    throw new HttpError(422, "invalid_active");
  return {
    slug,
    name,
    brand: str(body.brand, "brand", 60),
    price,
    old_price: oldPrice,
    stock: int(body.stock ?? 0, "stock", 0, 100_000),
    color,
    image_url: image,
    summary: body.summary === undefined ? "" : str(body.summary, "summary", 1000, 0),
    specs,
    active: body.active ?? true,
  };
}

function mapWriteError(err: unknown): never {
  const code = pgCode(err);
  if (code === "23505") throw new HttpError(409, "slug_taken");
  if (code === "23514") throw new HttpError(422, "invalid_input");
  throw err;
}

export async function createProduct(db: Db, tenantId: string, input: ProductInput) {
  try {
    return await withTenant(db, tenantId, (tx) =>
      tx.insertInto("products").values(input).returning(ADMIN_COLS).executeTakeFirstOrThrow(),
    );
  } catch (err) {
    return mapWriteError(err);
  }
}

export async function updateProduct(db: Db, tenantId: string, id: string, input: ProductInput) {
  if (!UUID_RE.test(id)) throw new HttpError(404, "not_found");
  let row: Awaited<ReturnType<typeof createProduct>> | undefined;
  try {
    row = await withTenant(db, tenantId, (tx) =>
      tx.updateTable("products").set(input).where("id", "=", id).returning(ADMIN_COLS).executeTakeFirst(),
    );
  } catch (err) {
    return mapWriteError(err);
  }
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

// ---------- Đơn hàng ----------

export interface OrderInput {
  customer_name: string;
  phone: string;
  address: string;
  note: string;
  items: { product_id: string; qty: number }[];
}

export function normalizePhone(v: unknown): string {
  if (typeof v !== "string") throw new HttpError(422, "invalid_phone");
  const phone = v.replace(/[\s.-]/g, "");
  if (!PHONE_RE.test(phone)) throw new HttpError(422, "invalid_phone");
  return phone;
}

export function parseOrder(body: Record<string, unknown>): OrderInput {
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new HttpError(422, "invalid_items");
  const merged = new Map<string, number>();
  for (const it of raw) {
    const o = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>;
    const id = o.product_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new HttpError(422, "invalid_items");
    const qty = (merged.get(id) ?? 0) + int(o.qty, "items", 1, 10);
    if (qty > 10) throw new HttpError(422, "invalid_items");
    merged.set(id, qty);
  }
  return {
    customer_name: str(body.customer_name, "customer_name", 120),
    phone: normalizePhone(body.phone),
    address: str(body.address, "address", 300),
    note: body.note === undefined ? "" : str(body.note, "note", 500, 0),
    items: [...merged]
      .map(([product_id, qty]) => ({ product_id, qty }))
      .sort((a, b) => a.product_id.localeCompare(b.product_id)),
  };
}

function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function createOrder(db: Db, tenantId: string, input: OrderInput) {
  return withTenant(db, tenantId, async (tx) => {
    const lines: { product_id: string; name: string; unit_price: number; qty: number }[] = [];
    let total = 0;
    // Thứ tự id cố định (parseOrder đã sắp) → hai đơn trộn cùng sản phẩm không khoá chéo nhau.
    for (const { product_id, qty } of input.items) {
      const p = await tx
        .updateTable("products")
        .set((eb) => ({ stock: eb("stock", "-", qty) }))
        .where("id", "=", product_id)
        .where("active", "=", true)
        .where("stock", ">=", qty)
        .returning(["name", "price"])
        .executeTakeFirst();
      if (!p) throw new HttpError(409, "out_of_stock");
      total += p.price * qty;
      lines.push({ product_id, name: p.name, unit_price: p.price, qty });
    }
    if (total > MAX_MONEY) throw new HttpError(422, "invalid_items");
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await tx
        .insertInto("orders")
        .values({
          code: newCode(),
          customer_name: input.customer_name,
          phone: input.phone,
          address: input.address,
          note: input.note,
          total,
        })
        .onConflict((oc) => oc.columns(["tenant_id", "code"]).doNothing())
        .returning(["id", "code", "total", "status"])
        .executeTakeFirst();
      if (!order) continue;
      await tx
        .insertInto("order_items")
        .values(lines.map((l) => ({ ...l, order_id: order.id })))
        .execute();
      return { code: order.code, total: order.total, status: order.status };
    }
    throw new Error("không sinh được mã đơn duy nhất");
  });
}

export async function lookupOrder(db: Db, tenantId: string, code: string, phone: string) {
  const found = await withTenant(db, tenantId, async (tx) => {
    const order = await tx
      .selectFrom("orders")
      .select(["id", "code", "status", "total", "created_at"])
      .where("code", "=", code.toUpperCase())
      .where("phone", "=", phone)
      .executeTakeFirst();
    if (!order) return null;
    const items = await tx
      .selectFrom("order_items")
      .select(["name", "unit_price", "qty"])
      .where("order_id", "=", order.id)
      .execute();
    return { order, items };
  });
  if (!found) throw new HttpError(404, "not_found"); // sai mã hay sai số điện thoại đều 404: không lộ mã có thật
  const { id: _id, ...order } = found.order;
  return { ...order, items: found.items };
}

export async function listOrders(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const orders = await tx
      .selectFrom("orders")
      .select(["id", "code", "customer_name", "phone", "address", "note", "total", "status", "created_at"])
      .orderBy("created_at", "desc")
      .limit(200)
      .execute();
    const items = orders.length
      ? await tx
          .selectFrom("order_items")
          .select(["order_id", "name", "unit_price", "qty"])
          .where(
            "order_id",
            "in",
            orders.map((o) => o.id),
          )
          .execute()
      : [];
    return orders.map((o) => ({
      ...o,
      items: items
        .filter((i) => i.order_id === o.id)
        .map(({ name, unit_price, qty }) => ({ name, unit_price, qty })),
    }));
  });
}

export async function setOrderStatus(db: Db, tenantId: string, id: string, status: unknown) {
  if (typeof status !== "string" || !ORDER_STATUSES.includes(status as OrderStatus)) {
    throw new HttpError(422, "invalid_status");
  }
  if (!UUID_RE.test(id)) throw new HttpError(404, "not_found");
  return withTenant(db, tenantId, async (tx) => {
    const order = await tx
      .selectFrom("orders")
      .select(["id", "status"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new HttpError(404, "not_found");
    if (order.status === "cancelled" && status !== "cancelled") throw new HttpError(409, "order_closed");
    if (status === "cancelled" && order.status !== "cancelled") {
      const items = await tx
        .selectFrom("order_items")
        .select(["product_id", "qty"])
        .where("order_id", "=", id)
        .execute();
      for (const it of items) {
        await tx
          .updateTable("products")
          .set((eb) => ({ stock: eb("stock", "+", it.qty) }))
          .where("id", "=", it.product_id)
          .execute();
      }
    }
    await tx
      .updateTable("orders")
      .set({ status: status as OrderStatus })
      .where("id", "=", id)
      .execute();
    return { id, status };
  });
}

// ---------- Giới hạn tần suất ----------

// Cửa sổ trượt trong bộ nhớ theo khoá (IP): chặn bơm đơn rác. Một tiến trình; nhiều bản sao cần kho chung (ghi nợ).
export class RateLimit {
  readonly #hits = new Map<string, number[]>();
  readonly #max: number;
  readonly #windowMs: number;
  constructor(max: number, windowMs: number) {
    this.#max = max;
    this.#windowMs = windowMs;
  }
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs);
    if (recent.length >= this.#max) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 10_000) {
      for (const [k, v] of this.#hits) if (v.every((t) => now - t >= this.#windowMs)) this.#hits.delete(k);
    }
    return true;
  }
}
