// Trang quản trị: đăng nhập, quản lý sản phẩm, xử lý đơn. Token phiên giữ trong sessionStorage (mất khi đóng tab).

const main = document.getElementById("main");
const money = (n) => `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;
const STATUS = {
  new: "Mới đặt",
  confirmed: "Đã xác nhận",
  shipping: "Đang giao",
  done: "Hoàn tất",
  cancelled: "Đã huỷ",
};
const SPEC_KEYS = ["Màn hình", "Chip", "RAM", "Bộ nhớ", "Camera", "Pin", "Hệ điều hành"];

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let token = "";
try {
  token = sessionStorage.getItem("admin-token") ?? "";
} catch {
  token = "";
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/v1/login") {
    logout();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const e = new Error(json.error ?? "error");
    e.code = json.error ?? "error";
    throw e;
  }
  return json;
}

const ERR = {
  invalid_credentials: "Sai email hoặc mật khẩu.",
  busy: "Hệ thống đang bận, thử lại sau giây lát.",
  slug_taken: "Đường dẫn (slug) đã tồn tại.",
  invalid_old_price: "Giá cũ phải lớn hơn hoặc bằng giá bán.",
  invalid_image_url: "Ảnh phải là địa chỉ https://",
  order_closed: "Đơn đã huỷ, không thể mở lại.",
};
const errText = (e) => ERR[e.code] ?? `Lỗi: ${e.code ?? e.message}`;

function setToken(t) {
  token = t;
  try {
    if (t) sessionStorage.setItem("admin-token", t);
    else sessionStorage.removeItem("admin-token");
  } catch {
    // bỏ qua: phiên chỉ sống trong tab này
  }
}

function logout() {
  setToken("");
  document.getElementById("logout").hidden = true;
  loginView();
}
document.getElementById("logout").addEventListener("click", logout);

function loginView() {
  const msg = h("p", { class: "error", role: "alert" });
  const email = h("input", { id: "email", type: "email", required: true, autocomplete: "username" });
  const pass = h("input", { id: "pass", type: "password", required: true, autocomplete: "current-password" });
  const form = h(
    "form",
    { class: "stack" },
    h("label", { for: "email" }, "Email", email),
    h("label", { for: "pass" }, "Mật khẩu", pass),
    msg,
    h("button", { type: "submit" }, "Đăng nhập"),
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.textContent = "";
    try {
      const { token: t } = await api("POST", "/v1/login", { email: email.value, password: pass.value });
      setToken(t);
      dashboard();
    } catch (e) {
      msg.textContent = errText(e);
    }
  });
  main.replaceChildren(h("h1", null, "Đăng nhập quản trị"), form);
}

function field(label, input, id) {
  input.id = id;
  return h("label", { for: id }, label, input);
}

function productForm(p, onSaved) {
  const v = p ?? {
    name: "",
    brand: "",
    price: 0,
    old_price: null,
    stock: 0,
    color: "#334155",
    image_url: "",
    summary: "",
    specs: {},
    active: true,
  };
  const f = {
    name: h("input", { required: true, maxlength: 200, value: v.name }),
    brand: h("input", { required: true, maxlength: 60, value: v.brand }),
    price: h("input", { type: "number", required: true, min: 0, value: v.price }),
    old: h("input", { type: "number", min: 0, value: v.old_price ?? "" }),
    stock: h("input", { type: "number", required: true, min: 0, value: v.stock }),
    color: h("input", { type: "color", value: v.color }),
    image: h("input", { type: "url", placeholder: "https://…", value: v.image_url ?? "" }),
    summary: h("textarea", { rows: 2, maxlength: 1000 }, v.summary),
    active: h("input", { type: "checkbox", checked: v.active }),
  };
  const specs = SPEC_KEYS.map((k) => [k, h("input", { maxlength: 200, value: v.specs?.[k] ?? "" })]);
  const msg = h("p", { class: "error", role: "alert" });
  const form = h(
    "form",
    { class: "stack panel" },
    h("h2", null, p ? `Sửa: ${p.name}` : "Thêm sản phẩm"),
    field("Tên", f.name, "p-name"),
    field("Hãng", f.brand, "p-brand"),
    field("Giá bán (₫)", f.price, "p-price"),
    field("Giá gốc (₫, để trống nếu không giảm)", f.old, "p-old"),
    field("Tồn kho", f.stock, "p-stock"),
    field("Màu minh hoạ", f.color, "p-color"),
    field("Ảnh (https, tuỳ chọn)", f.image, "p-image"),
    field("Mô tả ngắn", f.summary, "p-summary"),
    ...specs.map(([k, input], i) => field(k, input, `p-spec-${i}`)),
    h("label", null, h("span", null, f.active, " Đang bán")),
    msg,
    h("button", { type: "submit" }, "Lưu"),
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.textContent = "";
    const body = {
      name: f.name.value,
      brand: f.brand.value,
      price: Number(f.price.value),
      old_price: f.old.value === "" ? null : Number(f.old.value),
      stock: Number(f.stock.value),
      color: f.color.value,
      image_url: f.image.value.trim() || null,
      summary: f.summary.value,
      specs: Object.fromEntries(specs.filter(([, i]) => i.value.trim()).map(([k, i]) => [k, i.value.trim()])),
      active: f.active.checked,
    };
    if (p) body.slug = p.slug;
    try {
      if (p) await api("PUT", `/v1/admin/products/${p.id}`, body);
      else await api("POST", "/v1/admin/products", body);
      toast("Đã lưu");
      onSaved();
    } catch (e) {
      msg.textContent = errText(e);
    }
  });
  return form;
}

async function dashboard() {
  document.getElementById("logout").hidden = false;
  const products = h("div", null);
  const orders = h("div", null);
  const editor = h("div", null);
  main.replaceChildren(
    h("h1", null, "Quản trị cửa hàng"),
    h("h2", null, "Đơn hàng"),
    orders,
    h("h2", null, "Sản phẩm"),
    products,
    editor,
  );

  async function loadOrders() {
    const { orders: list } = await api("GET", "/v1/admin/orders");
    orders.replaceChildren(
      list.length
        ? h(
            "div",
            { class: "table-scroll panel" },
            h(
              "table",
              null,
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ["Mã", "Khách", "Sản phẩm", "Tổng", "Trạng thái"].map((t) => h("th", { scope: "col" }, t)),
                ),
              ),
              h(
                "tbody",
                null,
                list.map((o) => {
                  const sel = h(
                    "select",
                    { "aria-label": `Trạng thái đơn ${o.code}` },
                    Object.entries(STATUS).map(([k, t]) =>
                      h("option", { value: k, selected: o.status === k }, t),
                    ),
                  );
                  sel.addEventListener("change", async () => {
                    try {
                      await api("PATCH", `/v1/admin/orders/${o.id}`, { status: sel.value });
                      toast("Đã cập nhật đơn");
                      await Promise.all([loadOrders(), loadProducts()]);
                    } catch (e) {
                      toast(errText(e));
                      sel.value = o.status;
                    }
                  });
                  return h(
                    "tr",
                    null,
                    h(
                      "td",
                      null,
                      o.code,
                      h("div", { class: "muted" }, new Date(o.created_at).toLocaleString("vi-VN")),
                    ),
                    h(
                      "td",
                      null,
                      o.customer_name,
                      h("div", { class: "muted" }, o.phone),
                      h("div", { class: "muted" }, o.address),
                      o.note ? h("div", { class: "muted" }, `Ghi chú: ${o.note}`) : null,
                    ),
                    h(
                      "td",
                      null,
                      o.items.map((i) => h("div", null, `${i.name} × ${i.qty}`)),
                    ),
                    h("td", null, money(o.total)),
                    h("td", null, sel),
                  );
                }),
              ),
            ),
          )
        : h("p", { class: "muted" }, "Chưa có đơn hàng."),
    );
  }

  async function loadProducts() {
    const { products: list } = await api("GET", "/v1/admin/products?sort=newest");
    products.replaceChildren(
      h(
        "p",
        null,
        h(
          "button",
          { type: "button", onclick: () => editor.replaceChildren(productForm(null, saved)) },
          "+ Thêm sản phẩm",
        ),
      ),
      h(
        "div",
        { class: "table-scroll panel" },
        h(
          "table",
          null,
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              ["Tên", "Hãng", "Giá", "Tồn", "Bán", ""].map((t) => h("th", { scope: "col" }, t)),
            ),
          ),
          h(
            "tbody",
            null,
            list.map((p) =>
              h(
                "tr",
                null,
                h("td", null, p.name),
                h("td", null, p.brand),
                h("td", null, money(p.price)),
                h("td", null, p.stock),
                h("td", null, p.active ? "Có" : "Ẩn"),
                h(
                  "td",
                  null,
                  h(
                    "button",
                    {
                      type: "button",
                      class: "ghost",
                      onclick: () => {
                        editor.replaceChildren(productForm(p, saved));
                        editor.scrollIntoView();
                      },
                    },
                    "Sửa",
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function saved() {
    editor.replaceChildren();
    loadProducts().catch(() => {});
  }

  try {
    await Promise.all([loadOrders(), loadProducts()]);
  } catch (e) {
    if (e.message !== "unauthorized") main.replaceChildren(h("p", { class: "error" }, errText(e)));
  }
}

if (token) dashboard();
else loginView();
