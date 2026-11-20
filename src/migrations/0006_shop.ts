// 0006 — cửa hàng điện thoại: sản phẩm, đơn hàng, dòng đơn; cô lập theo tenant bằng RLS (ENABLE + FORCE).
// Bỏ bảng mẫu `notes` của bản khởi đầu (sản phẩm không dùng). Giá tính bằng đồng (số nguyên), không dùng số thực.
// Không xoá cứng sản phẩm: ngừng bán = `active = false`, để dòng đơn cũ vẫn trỏ được tới sản phẩm.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '60s';
    REVOKE ALL ON notes FROM app_rw;
    DROP TABLE notes;

    CREATE TABLE products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL DEFAULT app.current_tenant() REFERENCES tenants (id),
      slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
      brand text NOT NULL CHECK (length(btrim(brand)) BETWEEN 1 AND 60),
      price integer NOT NULL CHECK (price >= 0),
      old_price integer CHECK (old_price IS NULL OR old_price >= price),
      stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
      color text NOT NULL DEFAULT '#334155' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
      image_url text CHECK (image_url IS NULL OR (image_url ~ '^https://' AND length(image_url) <= 500)),
      summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
      specs jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(specs) = 'object'),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, slug)
    );
    CREATE INDEX products_tenant_active ON products (tenant_id, active, brand, price);

    CREATE TABLE orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL DEFAULT app.current_tenant() REFERENCES tenants (id),
      code text NOT NULL CHECK (code ~ '^[A-Z0-9]{8}$'),
      customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 1 AND 120),
      phone text NOT NULL CHECK (phone ~ '^(0|\\+84)[0-9]{9,10}$'),
      address text NOT NULL CHECK (length(btrim(address)) BETWEEN 1 AND 300),
      note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
      total integer NOT NULL CHECK (total >= 0),
      status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'shipping', 'done', 'cancelled')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, code)
    );
    CREATE INDEX orders_tenant_created ON orders (tenant_id, created_at DESC);

    CREATE TABLE order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL DEFAULT app.current_tenant() REFERENCES tenants (id),
      order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products (id),
      name text NOT NULL,
      unit_price integer NOT NULL CHECK (unit_price >= 0),
      qty integer NOT NULL CHECK (qty BETWEEN 1 AND 10)
    );
    CREATE INDEX order_items_order ON order_items (order_id);

    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE products FORCE ROW LEVEL SECURITY;
    CREATE POLICY products_tenant ON products
      USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders FORCE ROW LEVEL SECURITY;
    CREATE POLICY orders_tenant ON orders
      USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
    ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
    CREATE POLICY order_items_tenant ON order_items
      USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

    GRANT SELECT, INSERT, UPDATE ON products TO app_rw;
    GRANT SELECT, INSERT, UPDATE ON orders TO app_rw;
    GRANT SELECT, INSERT ON order_items TO app_rw;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '60s';
    REVOKE ALL ON order_items, orders, products FROM app_rw;
    DROP TABLE order_items;
    DROP TABLE orders;
    DROP TABLE products;
    CREATE TABLE notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL DEFAULT app.current_tenant() REFERENCES tenants (id),
      body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notes_tenant_created ON notes (tenant_id, created_at DESC);
    ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notes FORCE ROW LEVEL SECURITY;
    CREATE POLICY notes_tenant ON notes
      USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
    GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO app_rw;
  `.execute(db);
}
