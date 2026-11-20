// API HTTP tối giản (node:http, không framework). Hợp đồng: contract/openapi.json — test/contract.test.ts kiểm cả hai
// chiều (không đổi không tương thích so với contract/baseline.json; phản hồi thật có đủ trường bắt buộc).
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { authenticate, login, type Principal } from "./auth.ts";
import { createDb, type Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import {
  createOrder,
  createProduct,
  getProductBySlug,
  listOrders,
  listProducts,
  lookupOrder,
  normalizePhone,
  parseFilter,
  parseOrder,
  parseProduct,
  RateLimit,
  setOrderStatus,
  updateProduct,
} from "./shop.ts";
import { serveShopUi } from "./shop-ui.ts";

const MAX_BODY = 64 * 1024;

// Số `POST /v1/login` chạy scrypt cùng lúc (mỗi lần ~128 MiB + ~0,3 s trên threadpool libuv dùng chung với DNS/fs):
// đầy → 503 `busy` + `retry-after`, không xếp hàng vô hạn (AUD-SEC-532). Ghi đè: env LOGIN_CONCURRENCY.
export const DEFAULT_LOGIN_CONCURRENCY = 2;
const RETRY_AFTER_S = "1";

// Đặt đơn và tra cứu đơn công khai nên có giới hạn theo IP (bơm đơn rác, dò mã đơn). Ghi đè qua AppOptions.
export const DEFAULT_ORDER_LIMIT = { max: 10, windowMs: 10 * 60_000 };
export const DEFAULT_LOOKUP_LIMIT = { max: 30, windowMs: 10 * 60_000 };

// Semaphore không chờ: `tryAcquire` trả false khi đầy (người gọi trả 503 ngay), `release` gọi đúng một lần mỗi lần lấy.
export class Slots {
  readonly limit: number;
  #used = 0;
  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("số chỗ phải là số nguyên ≥ 1");
    }
    this.limit = limit;
  }
  get used(): number {
    return this.#used;
  }
  tryAcquire(): boolean {
    if (this.#used >= this.limit) return false;
    this.#used += 1;
    return true;
  }
  release(): void {
    if (this.#used < 1) throw new Error("release nhiều hơn acquire");
    this.#used -= 1;
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw new HttpError(413, "body_too_large");
    }
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // rơi xuống lỗi chung
  }
  throw new HttpError(400, "invalid_json");
}

async function principal(db: Db, req: IncomingMessage): Promise<Principal> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const who = token ? await authenticate(db, token) : null;
  if (!who) {
    throw new HttpError(401, "unauthorized");
  }
  return who;
}

function text(body: Record<string, unknown>, key: string, max: number): string {
  const v = body[key];
  if (typeof v !== "string" || v.length < 1 || v.length > max) {
    throw new HttpError(422, `invalid_${key}`);
  }
  return v;
}

interface Ctx {
  db: Db;
  loginSlots: Slots;
  orderLimit: RateLimit;
  lookupLimit: RateLimit;
  shopTenant: () => Promise<string>;
}

// Cửa hàng một chủ: khách (không đăng nhập) đọc và đặt hàng trong tenant của cửa hàng — env SHOP_TENANT_ID, mặc định
// tenant tạo sớm nhất. Chưa có tenant (chưa chạy `pnpm seed`) → 503, không cache để seed xong là dùng được ngay.
function shopTenantResolver(db: Db, fixed: string | undefined): () => Promise<string> {
  let cached = fixed;
  return async () => {
    if (cached) return cached;
    const row = await db.selectFrom("tenants").select("id").orderBy("created_at").limit(1).executeTakeFirst();
    if (!row) throw new HttpError(503, "shop_not_ready");
    cached = row.id;
    return cached;
  };
}

function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function limit(rl: RateLimit, req: IncomingMessage): void {
  if (!rl.allow(clientKey(req))) throw new HttpError(429, "too_many_requests", { "retry-after": "60" });
}

function params(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://localhost").searchParams;
}

type Handler = (ctx: Ctx, req: IncomingMessage, id: string) => Promise<[number, unknown]>;

const postLogin: Handler = async ({ db, loginSlots }, req) => {
  // Đọc + kiểm body trước khi giữ chỗ: client gửi chậm không chiếm chỗ của scrypt.
  const body = await readJson(req);
  const email = text(body, "email", 320);
  const password = text(body, "password", 1000);
  if (!loginSlots.tryAcquire()) {
    throw new HttpError(503, "busy", { "retry-after": RETRY_AFTER_S });
  }
  let token: string | null;
  try {
    token = await login(db, email, password);
  } finally {
    loginSlots.release();
  }
  if (!token) {
    throw new HttpError(401, "invalid_credentials");
  }
  return [200, { token }];
};

// ----- Công khai (khách) -----

const getProducts: Handler = async ({ db, shopTenant }, req) => {
  const products = await listProducts(db, await shopTenant(), parseFilter(params(req)));
  return [200, { products }];
};

const getProduct: Handler = async ({ db, shopTenant }, _req, slug) => [
  200,
  await getProductBySlug(db, await shopTenant(), slug),
];

const postOrder: Handler = async ({ db, shopTenant, orderLimit }, req) => {
  limit(orderLimit, req);
  const input = parseOrder(await readJson(req));
  return [201, await createOrder(db, await shopTenant(), input)];
};

const postOrderLookup: Handler = async ({ db, shopTenant, lookupLimit }, req) => {
  limit(lookupLimit, req);
  const body = await readJson(req);
  return [200, await lookupOrder(db, await shopTenant(), text(body, "code", 8), normalizePhone(body.phone))];
};

// ----- Quản trị (cần đăng nhập; tenant lấy từ phiên, không từ client) -----

const adminProducts: Handler = async ({ db }, req) => {
  const who = await principal(db, req);
  return [200, { products: await listProducts(db, who.tenantId, parseFilter(params(req)), true) }];
};

const adminCreateProduct: Handler = async ({ db }, req) => {
  const who = await principal(db, req);
  return [201, await createProduct(db, who.tenantId, parseProduct(await readJson(req)))];
};

const adminUpdateProduct: Handler = async ({ db }, req, id) => {
  const who = await principal(db, req);
  return [200, await updateProduct(db, who.tenantId, id, parseProduct(await readJson(req)))];
};

const adminOrders: Handler = async ({ db }, req) => {
  const who = await principal(db, req);
  return [200, { orders: await listOrders(db, who.tenantId) }];
};

const adminSetOrderStatus: Handler = async ({ db }, req, id) => {
  const who = await principal(db, req);
  return [200, await setOrderStatus(db, who.tenantId, id, (await readJson(req)).status)];
};

function route(method: string, path: string): [Handler, string] | null {
  if (method === "POST" && path === "/v1/login") return [postLogin, ""];
  if (method === "GET" && path === "/v1/products") return [getProducts, ""];
  if (method === "POST" && path === "/v1/orders") return [postOrder, ""];
  if (method === "POST" && path === "/v1/orders/lookup") return [postOrderLookup, ""];
  if (method === "GET" && path === "/v1/admin/products") return [adminProducts, ""];
  if (method === "POST" && path === "/v1/admin/products") return [adminCreateProduct, ""];
  if (method === "GET" && path === "/v1/admin/orders") return [adminOrders, ""];
  const product = /^\/v1\/products\/([^/]+)$/.exec(path);
  if (method === "GET" && product?.[1]) return [getProduct, product[1]];
  const adminProduct = /^\/v1\/admin\/products\/([^/]+)$/.exec(path);
  if (method === "PUT" && adminProduct?.[1]) return [adminUpdateProduct, adminProduct[1]];
  const adminOrder = /^\/v1\/admin\/orders\/([^/]+)$/.exec(path);
  if (method === "PATCH" && adminOrder?.[1]) return [adminSetOrderStatus, adminOrder[1]];
  return null;
}

function parsePath(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    throw new HttpError(400, "invalid_url");
  }
}

export function loginConcurrencyFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LOGIN_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_LOGIN_CONCURRENCY;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error("LOGIN_CONCURRENCY phải là số nguyên ≥ 1");
  }
  return Number(raw);
}

export interface AppOptions {
  loginConcurrency?: number;
  buildDigest?: string;
  liveAssets?: boolean;
  shopTenantId?: string;
  orderLimit?: { max: number; windowMs: number };
  lookupLimit?: { max: number; windowMs: number };
}

export function createApp(db: Db, opts: AppOptions = {}): Server {
  const orderLimit = opts.orderLimit ?? DEFAULT_ORDER_LIMIT;
  const lookupLimit = opts.lookupLimit ?? DEFAULT_LOOKUP_LIMIT;
  const ctx: Ctx = {
    db,
    loginSlots: new Slots(opts.loginConcurrency ?? loginConcurrencyFromEnv()),
    orderLimit: new RateLimit(orderLimit.max, orderLimit.windowMs),
    lookupLimit: new RateLimit(lookupLimit.max, lookupLimit.windowMs),
    shopTenant: shopTenantResolver(db, opts.shopTenantId ?? process.env.SHOP_TENANT_ID),
  };
  return createServer(async (req, res) => {
    // Mọi bước, kể cả parse URL, nằm trong try: llhttp nhận request-target mà WHATWG URL không parse được
    // (`GET http://[::1 HTTP/1.1`) — lỗi lọt ra ngoài handler async là unhandled rejection, Node thoát.
    try {
      const path = parsePath(req.url);
      if (serveShopUi(req.method, path, res, opts.liveAssets)) return;
      if (req.method === "GET" && path === "/healthz") {
        send(res, 200, { status: "ok", ...(opts.buildDigest ? { digest: opts.buildDigest } : {}) });
        return;
      }
      const found = route(req.method ?? "", path);
      if (!found) {
        throw new HttpError(404, "not_found");
      }
      const [status, body] = await found[0](ctx, req, found[1]);
      send(res, status, body);
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.code }, err.headers);
      } else {
        console.error(err);
        send(res, 500, { error: "internal" });
      }
    }
  });
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("thiếu DATABASE_URL");
    process.exit(2);
  }
  const port = Number(process.env.PORT ?? 3000);
  const opts: AppOptions = {};
  if (process.env.XT_PREVIEW_BUILD === "1") {
    opts.buildDigest = readFileSync(new URL("../.build-digest", import.meta.url), "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(opts.buildDigest)) throw new Error("Digest bản dev không hợp lệ");
  }
  createApp(createDb(url), opts).listen(port, () => console.log(`nghe :${port}`));
}
