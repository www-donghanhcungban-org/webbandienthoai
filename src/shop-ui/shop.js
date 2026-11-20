// Cửa hàng điện thoại — giao diện khách. Không framework; dữ liệu từ API luôn đưa vào DOM bằng textContent (chống XSS).

const main = document.getElementById("main");
const money = (n) => `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;
const SPEC_ORDER = ["Màn hình", "Chip", "RAM", "Bộ nhớ", "Camera", "Pin", "Hệ điều hành"];

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "color") el.style.setProperty("--c", v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function store(key, fallback) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // trình duyệt chặn lưu trữ: giỏ chỉ sống trong phiên này
  }
}

let cart = store("cart", []).filter((i) => i && typeof i.id === "string" && Number.isInteger(i.qty));
let compare = store("compare", [])
  .filter((s) => typeof s === "string")
  .slice(0, 3);

function syncBadges() {
  const n = cart.reduce((s, i) => s + i.qty, 0);
  const c = document.getElementById("cart-count");
  c.textContent = String(n);
  c.hidden = n === 0;
  const k = document.getElementById("cmp-count");
  k.textContent = String(compare.length);
  k.hidden = compare.length === 0;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

const ERRORS = {
  out_of_stock: "Có sản phẩm đã hết hàng hoặc không đủ số lượng. Vui lòng cập nhật giỏ hàng.",
  invalid_phone: "Số điện thoại không hợp lệ (ví dụ 0912345678).",
  invalid_customer_name: "Vui lòng nhập họ tên.",
  invalid_address: "Vui lòng nhập địa chỉ nhận hàng.",
  invalid_items: "Giỏ hàng không hợp lệ.",
  too_many_requests: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.",
  not_found: "Không tìm thấy. Kiểm tra lại thông tin.",
  shop_not_ready: "Cửa hàng chưa sẵn sàng. Vui lòng quay lại sau.",
};

async function api(path, body) {
  const res = await fetch(
    path,
    body === undefined
      ? {}
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ?? "error");
    err.code = json.error ?? "error";
    throw err;
  }
  return json;
}
const errText = (e) => ERRORS[e.code] ?? "Có lỗi xảy ra, vui lòng thử lại.";

function art(p) {
  return h(
    "div",
    { class: "art", color: p.color },
    p.image_url
      ? h("img", { src: p.image_url, alt: p.name, loading: "lazy", referrerpolicy: "no-referrer" })
      : h("div", { class: "phone", "aria-hidden": "true" }),
  );
}

function priceBlock(p) {
  return h(
    "div",
    { class: "price" },
    money(p.price),
    p.old_price && p.old_price > p.price ? h("span", { class: "old" }, money(p.old_price)) : null,
  );
}

function discount(p) {
  return p.old_price && p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
}

function addToCart(p, qty = 1) {
  if (p.stock < 1) return;
  const line = cart.find((i) => i.id === p.id);
  const next = Math.min(10, p.stock, (line?.qty ?? 0) + qty);
  if (line) line.qty = next;
  else cart.push({ id: p.id, slug: p.slug, name: p.name, price: p.price, qty: next });
  save("cart", cart);
  syncBadges();
  toast(`Đã thêm ${p.name} vào giỏ`);
}

function toggleCompare(slug, box) {
  if (compare.includes(slug)) compare = compare.filter((s) => s !== slug);
  else if (compare.length >= 3) {
    box.checked = false;
    toast("Chỉ so sánh tối đa 3 máy");
    return;
  } else compare.push(slug);
  save("compare", compare);
  syncBadges();
}

function card(p) {
  const off = discount(p);
  const box = h("input", {
    type: "checkbox",
    checked: compare.includes(p.slug),
    "aria-label": `So sánh ${p.name}`,
  });
  box.addEventListener("change", () => toggleCompare(p.slug, box));
  return h(
    "article",
    { class: "card" },
    off ? h("span", { class: "off" }, `-${off}%`) : null,
    art(p),
    h("h3", null, h("a", { href: `#/p/${p.slug}` }, p.name)),
    h("div", { class: "muted" }, p.summary || p.brand),
    priceBlock(p),
    p.stock < 1 ? h("div", { class: "stock-out" }, "Hết hàng") : null,
    h(
      "div",
      { class: "actions" },
      h("label", { class: "cmp" }, box, "So sánh"),
      h("button", { type: "button", disabled: p.stock < 1, onclick: () => addToCart(p) }, "Thêm vào giỏ"),
    ),
  );
}

// ---------- Trang chủ / danh mục ----------

const filters = { brand: "", sort: "newest", range: "", q: "" };
const RANGES = {
  "": "Mọi mức giá",
  "0-5000000": "Dưới 5 triệu",
  "5000000-10000000": "5 – 10 triệu",
  "10000000-20000000": "10 – 20 triệu",
  "20000000-": "Trên 20 triệu",
};

async function home() {
  document.title = "Điện Thoại Shop — điện thoại chính hãng";
  const list = h("div", { class: "grid", "aria-live": "polite" }, h("p", { class: "muted" }, "Đang tải…"));
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Hãng" });
  const sort = h(
    "select",
    { "aria-label": "Sắp xếp" },
    [
      ["newest", "Mới nhất"],
      ["price_asc", "Giá tăng dần"],
      ["price_desc", "Giá giảm dần"],
    ].map(([v, t]) => h("option", { value: v, selected: filters.sort === v }, t)),
  );
  const range = h(
    "select",
    { "aria-label": "Mức giá" },
    Object.entries(RANGES).map(([v, t]) => h("option", { value: v, selected: filters.range === v }, t)),
  );
  main.replaceChildren(
    h("h1", null, filters.q ? `Kết quả cho “${filters.q}”` : "Điện thoại chính hãng"),
    h("div", { class: "filters" }, chips, sort, range),
    list,
  );

  let brands = [];
  async function load() {
    const q = new URLSearchParams({ sort: filters.sort });
    if (filters.brand) q.set("brand", filters.brand);
    if (filters.q) q.set("q", filters.q);
    if (filters.range) {
      const [min, max] = filters.range.split("-");
      if (min && min !== "0") q.set("min", min);
      if (max) q.set("max", max);
    }
    try {
      const { products } = await api(`/v1/products?${q}`);
      if (!brands.length && !filters.brand && !filters.q && !filters.range)
        brands = [...new Set(products.map((p) => p.brand))].sort();
      renderChips();
      list.replaceChildren(
        ...(products.length
          ? products.map(card)
          : [h("p", { class: "empty" }, "Không có sản phẩm phù hợp.")]),
      );
    } catch (e) {
      list.replaceChildren(h("p", { class: "error" }, errText(e)));
    }
  }
  function renderChips() {
    chips.replaceChildren(
      ...["", ...brands].map((b) =>
        h(
          "button",
          {
            type: "button",
            class: "chip",
            "aria-pressed": String(filters.brand === b),
            onclick: () => {
              filters.brand = b;
              load();
            },
          },
          b || "Tất cả",
        ),
      ),
    );
  }
  sort.addEventListener("change", () => {
    filters.sort = sort.value;
    load();
  });
  range.addEventListener("change", () => {
    filters.range = range.value;
    load();
  });
  await load();
}

// ---------- Chi tiết ----------

async function detail(slug) {
  main.replaceChildren(h("p", { class: "muted" }, "Đang tải…"));
  let p;
  try {
    p = await api(`/v1/products/${encodeURIComponent(slug)}`);
  } catch (e) {
    main.replaceChildren(h("p", { class: "error" }, errText(e)), h("a", { href: "#/" }, "← Về trang chủ"));
    return;
  }
  document.title = `${p.name} — Điện Thoại Shop`;
  const qty = h("input", {
    type: "number",
    min: 1,
    max: Math.min(10, p.stock),
    value: 1,
    "aria-label": "Số lượng",
  });
  const rank = (k) => (SPEC_ORDER.includes(k) ? SPEC_ORDER.indexOf(k) : 99);
  const specs = Object.entries(p.specs).sort(([a], [b]) => rank(a) - rank(b));
  main.replaceChildren(
    h("p", null, h("a", { href: "#/" }, "← Tất cả điện thoại")),
    h(
      "div",
      { class: "detail" },
      art(p),
      h(
        "div",
        null,
        h("h1", null, p.name),
        h("p", { class: "muted" }, `Hãng ${p.brand}`),
        priceBlock(p),
        p.summary ? h("p", null, p.summary) : null,
        p.stock < 1
          ? h("p", { class: "stock-out" }, "Tạm hết hàng")
          : h("p", { class: "muted" }, p.stock <= 5 ? `Chỉ còn ${p.stock} máy` : "Còn hàng"),
        h(
          "div",
          { class: "row" },
          h("label", { class: "qty" }, "Số lượng", qty),
          h(
            "button",
            {
              type: "button",
              disabled: p.stock < 1,
              onclick: () => addToCart(p, Math.max(1, Math.min(10, Number(qty.value) || 1))),
            },
            "Thêm vào giỏ",
          ),
          h("a", { class: "btn ghost", href: "#/gio-hang", onclick: () => addToCart(p) }, "Mua ngay"),
        ),
        h("h2", null, "Thông số"),
        specs.length
          ? h(
              "div",
              { class: "table-scroll" },
              h(
                "table",
                null,
                specs.map(([k, v]) => h("tr", null, h("th", { scope: "row" }, k), h("td", null, v))),
              ),
            )
          : h("p", { class: "muted" }, "Đang cập nhật."),
      ),
    ),
  );
}

// ---------- Giỏ hàng / đặt hàng ----------

function total() {
  return cart.reduce((s, i) => s + i.price * i.qty, 0);
}

function cartView() {
  document.title = "Giỏ hàng — Điện Thoại Shop";
  if (!cart.length) {
    main.replaceChildren(
      h("h1", null, "Giỏ hàng"),
      h("p", { class: "empty" }, "Giỏ hàng trống."),
      h("a", { class: "btn", href: "#/" }, "Tiếp tục mua sắm"),
    );
    return;
  }
  const rows = cart.map((i) => {
    const input = h("input", {
      type: "number",
      min: 1,
      max: 10,
      value: i.qty,
      "aria-label": `Số lượng ${i.name}`,
    });
    input.addEventListener("change", () => {
      i.qty = Math.max(1, Math.min(10, Number(input.value) || 1));
      save("cart", cart);
      syncBadges();
      cartView();
    });
    return h(
      "tr",
      null,
      h("td", null, h("a", { href: `#/p/${i.slug}` }, i.name)),
      h("td", null, money(i.price)),
      h("td", null, input),
      h("td", null, money(i.price * i.qty)),
      h(
        "td",
        null,
        h(
          "button",
          {
            type: "button",
            class: "ghost",
            "aria-label": `Bỏ ${i.name}`,
            onclick: () => {
              cart = cart.filter((x) => x !== i);
              save("cart", cart);
              syncBadges();
              cartView();
            },
          },
          "Bỏ",
        ),
      ),
    );
  });
  main.replaceChildren(
    h("h1", null, "Giỏ hàng"),
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
            ["Sản phẩm", "Đơn giá", "SL", "Thành tiền", ""].map((t) => h("th", { scope: "col" }, t)),
          ),
        ),
        h("tbody", null, rows),
      ),
    ),
    h(
      "p",
      { class: "row" },
      h("strong", null, `Tổng: ${money(total())}`),
      h("a", { class: "btn", href: "#/dat-hang" }, "Đặt hàng"),
    ),
    h("p", { class: "muted" }, "Giá cuối cùng được xác nhận theo giá hiện tại của cửa hàng khi đặt hàng."),
  );
}

function checkout() {
  document.title = "Đặt hàng — Điện Thoại Shop";
  if (!cart.length) {
    location.hash = "#/gio-hang";
    return;
  }
  const msg = h("p", { class: "error", role: "alert" });
  const f = {
    name: h("input", { id: "f-name", required: true, maxlength: 120, autocomplete: "name" }),
    phone: h("input", {
      id: "f-phone",
      type: "tel",
      required: true,
      maxlength: 20,
      autocomplete: "tel",
      placeholder: "0912345678",
    }),
    address: h("textarea", {
      id: "f-address",
      required: true,
      maxlength: 300,
      rows: 3,
      autocomplete: "street-address",
    }),
    note: h("textarea", { id: "f-note", maxlength: 500, rows: 2 }),
  };
  const submit = h("button", { type: "submit" }, "Xác nhận đặt hàng (COD)");
  const form = h(
    "form",
    { class: "stack" },
    h("label", { for: "f-name" }, "Họ và tên", f.name),
    h("label", { for: "f-phone" }, "Số điện thoại", f.phone),
    h("label", { for: "f-address" }, "Địa chỉ nhận hàng", f.address),
    h("label", { for: "f-note" }, "Ghi chú (không bắt buộc)", f.note),
    h("p", null, h("strong", null, `Tổng thanh toán khi nhận hàng: ${money(total())}`)),
    msg,
    submit,
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.textContent = "";
    submit.disabled = true;
    try {
      const order = await api("/v1/orders", {
        customer_name: f.name.value,
        phone: f.phone.value,
        address: f.address.value,
        note: f.note.value,
        items: cart.map((i) => ({ product_id: i.id, qty: i.qty })),
      });
      cart = [];
      save("cart", cart);
      syncBadges();
      done(order, f.phone.value);
    } catch (e) {
      msg.textContent = errText(e);
      submit.disabled = false;
    }
  });
  main.replaceChildren(h("h1", null, "Đặt hàng"), form);
}

function done(order) {
  main.replaceChildren(
    h("h1", null, "Đặt hàng thành công 🎉"),
    h(
      "div",
      { class: "notice" },
      h("p", null, "Mã đơn của bạn: ", h("strong", null, order.code)),
      h("p", null, `Tổng tiền thanh toán khi nhận hàng: ${money(order.total)}`),
      h("p", null, "Hãy lưu mã đơn và số điện thoại để tra cứu. Cửa hàng sẽ liên hệ xác nhận sớm."),
    ),
    h(
      "p",
      null,
      h("a", { class: "btn", href: "#/tra-cuu" }, "Tra cứu đơn"),
      " ",
      h("a", { class: "btn ghost", href: "#/" }, "Tiếp tục mua sắm"),
    ),
  );
}

// ---------- So sánh / tra cứu ----------

const STATUS = {
  new: "Mới đặt",
  confirmed: "Đã xác nhận",
  shipping: "Đang giao",
  done: "Hoàn tất",
  cancelled: "Đã huỷ",
};

async function compareView() {
  document.title = "So sánh — Điện Thoại Shop";
  if (!compare.length) {
    main.replaceChildren(
      h("h1", null, "So sánh điện thoại"),
      h("p", { class: "empty" }, "Chọn tối đa 3 máy bằng ô “So sánh” ở trang danh sách."),
      h("a", { class: "btn", href: "#/" }, "Chọn máy"),
    );
    return;
  }
  main.replaceChildren(h("p", { class: "muted" }, "Đang tải…"));
  const items = (
    await Promise.all(compare.map((s) => api(`/v1/products/${encodeURIComponent(s)}`).catch(() => null)))
  ).filter(Boolean);
  compare = items.map((p) => p.slug);
  save("compare", compare);
  syncBadges();
  const keys = [...new Set([...SPEC_ORDER, ...items.flatMap((p) => Object.keys(p.specs))])].filter((k) =>
    items.some((p) => p.specs[k]),
  );
  main.replaceChildren(
    h("h1", null, "So sánh điện thoại"),
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
            h("th", { scope: "col" }, ""),
            items.map((p) => h("th", { scope: "col" }, h("a", { href: `#/p/${p.slug}` }, p.name))),
          ),
        ),
        h(
          "tbody",
          null,
          h(
            "tr",
            null,
            h("th", { scope: "row" }, "Giá"),
            items.map((p) => h("td", null, money(p.price))),
          ),
          keys.map((k) =>
            h(
              "tr",
              null,
              h("th", { scope: "row" }, k),
              items.map((p) => h("td", null, p.specs[k] ?? "—")),
            ),
          ),
        ),
      ),
    ),
    h(
      "p",
      null,
      h(
        "button",
        {
          type: "button",
          class: "ghost",
          onclick: () => {
            compare = [];
            save("compare", compare);
            syncBadges();
            compareView();
          },
        },
        "Xoá so sánh",
      ),
    ),
  );
}

function lookupView() {
  document.title = "Tra cứu đơn — Điện Thoại Shop";
  const out = h("div", { "aria-live": "polite" });
  const code = h("input", {
    id: "l-code",
    required: true,
    maxlength: 8,
    autocomplete: "off",
    placeholder: "VD: AB12CD34",
  });
  const phone = h("input", {
    id: "l-phone",
    type: "tel",
    required: true,
    maxlength: 20,
    autocomplete: "tel",
  });
  const form = h(
    "form",
    { class: "stack" },
    h("label", { for: "l-code" }, "Mã đơn", code),
    h("label", { for: "l-phone" }, "Số điện thoại đặt hàng", phone),
    h("button", { type: "submit" }, "Tra cứu"),
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const o = await api("/v1/orders/lookup", { code: code.value.trim(), phone: phone.value });
      out.replaceChildren(
        h(
          "div",
          { class: "panel" },
          h(
            "p",
            null,
            `Đơn ${o.code} · `,
            h("span", { class: `status ${o.status}` }, STATUS[o.status] ?? o.status),
          ),
          h(
            "ul",
            null,
            o.items.map((i) => h("li", null, `${i.name} × ${i.qty} — ${money(i.unit_price * i.qty)}`)),
          ),
          h("p", null, h("strong", null, `Tổng: ${money(o.total)}`)),
        ),
      );
    } catch (e) {
      out.replaceChildren(h("p", { class: "error" }, errText(e)));
    }
  });
  main.replaceChildren(h("h1", null, "Tra cứu đơn hàng"), form, out);
}

// ---------- Định tuyến ----------

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  try {
    if (hash === "/") await home();
    else if (hash.startsWith("/p/")) await detail(decodeURIComponent(hash.slice(3)));
    else if (hash === "/gio-hang") cartView();
    else if (hash === "/dat-hang") checkout();
    else if (hash === "/so-sanh") await compareView();
    else if (hash === "/tra-cuu") lookupView();
    else
      main.replaceChildren(
        h("p", { class: "empty" }, "Không tìm thấy trang."),
        h("a", { href: "#/" }, "Về trang chủ"),
      );
  } catch (e) {
    main.replaceChildren(h("p", { class: "error" }, errText(e)));
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

document.getElementById("search").addEventListener("submit", (ev) => {
  ev.preventDefault();
  filters.q = document.getElementById("q").value.trim();
  if (location.hash === "#/" || location.hash === "") route();
  else location.hash = "#/";
});
window.addEventListener("hashchange", route);
syncBadges();
route();
