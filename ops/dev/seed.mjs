// Two isolated demo users in the disposable preview database. Passwords belong to this project only.
import { createUser } from "../../src/auth.ts";
import { createDb } from "../../src/db.ts";

const url = new URL(process.env.DATABASE_URL);
if (
  process.env.XT_PREVIEW_BUILD !== "1" ||
  url.pathname !== "/xt_preview" ||
  !["db", "127.0.0.1", "localhost"].includes(url.hostname)
) {
  throw new Error("Seed chỉ chạy trên PostgreSQL dev cục bộ xt_preview");
}
const users = [
  ["owner", "a13d1fef-0580-4033-99b9-a43d0d213110", process.env.XT_DEMO_OWNER_PASSWORD],
  ["guest", "a13d1fef-0580-4033-99b9-a43d0d213111", process.env.XT_DEMO_GUEST_PASSWORD],
];
if (users.some(([, , password]) => !password || password.length < 20) || users[0][2] === users[1][2]) {
  throw new Error("Thiếu mật khẩu riêng của hai tài khoản dev");
}
const db = createDb(url.toString(), 1);
try {
  await db.transaction().execute(async (tx) => {
    for (const [name, id, password] of users) {
      const email = `${name}@example.test`;
      await tx
        .insertInto("tenants")
        .values({ id, name })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
      const user = await tx
        .selectFrom("users")
        .select("tenant_id")
        .where("email", "=", email)
        .executeTakeFirst();
      if (!user) await createUser(tx, id, email, password);
      else if (user.tenant_id !== id) throw new Error("Tài khoản dev không thuộc đúng tenant");
    }
  });
} finally {
  await db.destroy();
}
