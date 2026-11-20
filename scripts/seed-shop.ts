// Dữ liệu khởi tạo cho cửa hàng: tenant của cửa hàng, tài khoản quản trị (nếu có ADMIN_EMAIL + ADMIN_PASSWORD) và
// sản phẩm MẪU để xem thử giao diện. Giá, tồn kho và thông số là dữ liệu minh hoạ — thay bằng danh mục thật trong /admin.
// Chạy lại được: không ghi đè gì đã có. Dùng: DATABASE_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm seed
import { randomUUID } from "node:crypto";
import { createUser } from "../src/auth.ts";
import { createDb, withTenant } from "../src/db.ts";

interface Sample {
  slug: string;
  name: string;
  brand: string;
  price: number;
  old_price?: number;
  stock: number;
  color: string;
  summary: string;
  specs: Record<string, string>;
}

const spec = (
  screen: string,
  chip: string,
  ram: string,
  rom: string,
  camera: string,
  battery: string,
  os: string,
) => ({
  "Màn hình": screen,
  Chip: chip,
  RAM: ram,
  "Bộ nhớ": rom,
  Camera: camera,
  Pin: battery,
  "Hệ điều hành": os,
});

export const SAMPLES: Sample[] = [
  {
    slug: "iphone-16-pro-256gb",
    name: "iPhone 16 Pro 256GB",
    brand: "Apple",
    price: 28990000,
    old_price: 30990000,
    stock: 12,
    color: "#8d8a85",
    summary: "Titan nhẹ, camera 48MP, nút Camera Control.",
    specs: spec(
      '6.3" LTPO OLED 120Hz',
      "Apple A18 Pro",
      "8GB",
      "256GB",
      "48MP + 48MP + 12MP",
      "3582 mAh",
      "iOS 18",
    ),
  },
  {
    slug: "iphone-16-128gb",
    name: "iPhone 16 128GB",
    brand: "Apple",
    price: 22490000,
    stock: 20,
    color: "#3b6fb6",
    summary: "Chip A18, nút Hành động, camera Fusion 48MP.",
    specs: spec('6.1" OLED 60Hz', "Apple A18", "8GB", "128GB", "48MP + 12MP", "3561 mAh", "iOS 18"),
  },
  {
    slug: "iphone-15-128gb",
    name: "iPhone 15 128GB",
    brand: "Apple",
    price: 17990000,
    old_price: 19990000,
    stock: 8,
    color: "#d8b4c4",
    summary: "Dynamic Island, cổng USB-C, camera 48MP.",
    specs: spec('6.1" OLED 60Hz', "Apple A16 Bionic", "6GB", "128GB", "48MP + 12MP", "3349 mAh", "iOS 17"),
  },
  {
    slug: "samsung-galaxy-s25-ultra-256gb",
    name: "Samsung Galaxy S25 Ultra 256GB",
    brand: "Samsung",
    price: 31990000,
    old_price: 33990000,
    stock: 10,
    color: "#4b5563",
    summary: "Bút S Pen, camera 200MP, Galaxy AI.",
    specs: spec(
      '6.9" Dynamic AMOLED 2X 120Hz',
      "Snapdragon 8 Elite",
      "12GB",
      "256GB",
      "200MP + 50MP + 10MP + 50MP",
      "5000 mAh",
      "Android 15",
    ),
  },
  {
    slug: "samsung-galaxy-s25-256gb",
    name: "Samsung Galaxy S25 256GB",
    brand: "Samsung",
    price: 22990000,
    stock: 14,
    color: "#0ea5a4",
    summary: "Nhỏ gọn, mạnh mẽ, Galaxy AI.",
    specs: spec(
      '6.2" Dynamic AMOLED 2X 120Hz',
      "Snapdragon 8 Elite",
      "12GB",
      "256GB",
      "50MP + 12MP + 10MP",
      "4000 mAh",
      "Android 15",
    ),
  },
  {
    slug: "samsung-galaxy-a56-5g-256gb",
    name: "Samsung Galaxy A56 5G 256GB",
    brand: "Samsung",
    price: 10990000,
    stock: 25,
    color: "#a78bfa",
    summary: "Tầm trung 5G, màn hình Super AMOLED 120Hz.",
    specs: spec(
      '6.7" Super AMOLED 120Hz',
      "Exynos 1580",
      "8GB",
      "256GB",
      "50MP + 12MP + 5MP",
      "5000 mAh",
      "Android 15",
    ),
  },
  {
    slug: "xiaomi-15-256gb",
    name: "Xiaomi 15 256GB",
    brand: "Xiaomi",
    price: 21990000,
    old_price: 23990000,
    stock: 9,
    color: "#16a34a",
    summary: "Camera Leica, Snapdragon 8 Elite, sạc nhanh 90W.",
    specs: spec(
      '6.36" LTPO AMOLED 120Hz',
      "Snapdragon 8 Elite",
      "12GB",
      "256GB",
      "50MP + 50MP + 50MP",
      "5240 mAh",
      "Xiaomi HyperOS 2",
    ),
  },
  {
    slug: "redmi-note-14-pro-256gb",
    name: "Redmi Note 14 Pro 256GB",
    brand: "Xiaomi",
    price: 7990000,
    stock: 40,
    color: "#0f172a",
    summary: "Camera 200MP, màn hình AMOLED 120Hz giá tốt.",
    specs: spec(
      '6.67" AMOLED 120Hz',
      "MediaTek Helio G99-Ultra",
      "8GB",
      "256GB",
      "200MP + 8MP + 2MP",
      "5110 mAh",
      "Xiaomi HyperOS",
    ),
  },
  {
    slug: "oppo-find-x8-256gb",
    name: "OPPO Find X8 256GB",
    brand: "OPPO",
    price: 19990000,
    stock: 6,
    color: "#e11d48",
    summary: "Camera Hasselblad, sạc nhanh 80W.",
    specs: spec(
      '6.59" AMOLED 120Hz',
      "MediaTek Dimensity 9400",
      "12GB",
      "256GB",
      "50MP + 50MP + 50MP",
      "5630 mAh",
      "ColorOS 15",
    ),
  },
  {
    slug: "oppo-reno13-f-5g-256gb",
    name: "OPPO Reno13 F 5G 256GB",
    brand: "OPPO",
    price: 8990000,
    old_price: 9490000,
    stock: 18,
    color: "#f59e0b",
    summary: "Mỏng nhẹ, chống nước IP65, sạc nhanh 45W.",
    specs: spec(
      '6.67" AMOLED 120Hz',
      "Snapdragon 6 Gen 1",
      "8GB",
      "256GB",
      "50MP + 8MP + 2MP",
      "5800 mAh",
      "ColorOS 15",
    ),
  },
  {
    slug: "vivo-v50-5g-256gb",
    name: "vivo V50 5G 256GB",
    brand: "vivo",
    price: 11990000,
    stock: 0,
    color: "#7c3aed",
    summary: "Camera ZEISS, pin 6000 mAh.",
    specs: spec(
      '6.77" AMOLED 120Hz',
      "Snapdragon 7 Gen 3",
      "12GB",
      "256GB",
      "50MP + 50MP",
      "6000 mAh",
      "Funtouch OS 15",
    ),
  },
  {
    slug: "honor-400-5g-512gb",
    name: "HONOR 400 5G 512GB",
    brand: "HONOR",
    price: 12990000,
    stock: 11,
    color: "#0284c7",
    summary: "Camera 200MP, màn hình 5000 nit, AI.",
    specs: spec(
      '6.55" AMOLED 120Hz',
      "Snapdragon 7 Gen 3",
      "12GB",
      "512GB",
      "200MP + 12MP",
      "5300 mAh",
      "MagicOS 9",
    ),
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("thiếu DATABASE_URL");
  const db = createDb(url, 2);
  try {
    // SHOP_TENANT_ID (cùng biến mà server dùng) chọn đúng tenant của cửa hàng; vắng thì tenant tạo sớm nhất.
    const fixed = process.env.SHOP_TENANT_ID;
    let query = db.selectFrom("tenants").select("id");
    query = fixed ? query.where("id", "=", fixed) : query.orderBy("created_at").limit(1);
    let tenant = await query.executeTakeFirst();
    if (fixed && !tenant) throw new Error("SHOP_TENANT_ID không trỏ tới tenant nào");
    if (!tenant) {
      const id = randomUUID();
      await db.insertInto("tenants").values({ id, name: "Điện Thoại Shop" }).execute();
      tenant = { id };
      console.log("đã tạo cửa hàng");
    }
    const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
    if (email && password) {
      if (password.length < 12) throw new Error("ADMIN_PASSWORD cần ít nhất 12 ký tự");
      const exists = await db
        .selectFrom("users")
        .select("id")
        .where("email", "=", email.trim().toLowerCase())
        .executeTakeFirst();
      if (!exists) {
        await createUser(db, tenant.id, email, password);
        console.log(`đã tạo tài khoản quản trị ${email}`);
      }
    } else {
      console.log("bỏ qua tài khoản quản trị (đặt ADMIN_EMAIL và ADMIN_PASSWORD để tạo)");
    }
    const added = await withTenant(db, tenant.id, async (tx) => {
      let n = 0;
      for (const s of SAMPLES) {
        const r = await tx
          .insertInto("products")
          .values({ ...s, old_price: s.old_price ?? null, image_url: null })
          .onConflict((oc) => oc.columns(["tenant_id", "slug"]).doNothing())
          .executeTakeFirst();
        n += Number(r.numInsertedOrUpdatedRows ?? 0);
      }
      return n;
    });
    console.log(`đã thêm ${added} sản phẩm mẫu`);
  } finally {
    await db.destroy();
  }
}

if (import.meta.main) await main();
