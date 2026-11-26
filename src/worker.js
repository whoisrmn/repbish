const regions = ["Улаанбаатар","Архангай","Баян-Өлгий","Баянхонгор","Булган","Говь-Алтай","Говьсүмбэр","Дархан-Уул","Дорноговь","Дорнод","Дундговь","Завхан","Орхон","Өвөрхангай","Өмнөговь","Сүхбаатар","Сэлэнгэ","Төв","Увс","Ховд","Хөвсгөл","Хэнтий"];
const categories = ["tops", "bottoms", "outerwear", "accessories"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const imageKey = /^[a-f0-9-]{36}\.(webp|jpg|png)$/;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const hashHex = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))),
  byte => byte.toString(16).padStart(2, "0")).join("");
const statement = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
const first = (env, sql, ...values) => statement(env, sql, ...values).first();
const rows = async (env, sql, ...values) => (await statement(env, sql, ...values).all()).results;
const run = (env, sql, ...values) => statement(env, sql, ...values).run();
const securityHeaders = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
};
function response(body, type, status = 200, cache = "no-store") {
  return new Response(body, { status, headers: { ...securityHeaders, "Content-Type": type, "Cache-Control": cache } });
}
function json(data, status = 200) {
  return response(JSON.stringify(data), "application/json; charset=utf-8", status);
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function check(condition, message = "Мэдээллээ шалгана уу.", status = 400) {
  if (!condition) throw new HttpError(status, message);
}
function textField(value, maximum, minimum = 1) {
  check(typeof value === "string");
  const valueText = value.trim();
  check(valueText.length >= minimum && valueText.length <= maximum);
  return valueText;
}
function integer(value, min, max) {
  check(Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}
async function readBody(request, limit) {
  check(Number(request.headers.get("Content-Length")) <= limit, "Файл хэт том байна.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      check(false, "Файл хэт том байна.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function decodeJson(bytes) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, "Мэдээлэл унших боломжгүй байна."); }
}
async function requestJson(request) {
  const data = decodeJson(await readBody(request, 48_000));
  check(data && typeof data === "object" && !Array.isArray(data));
  return data;
}
function checkoutReady(env) {
  return env.CHECKOUT_ENABLED === "true" && Boolean(env.WIRE_API_KEY && env.WIRE_WEBHOOK_SECRET);
}
async function adminAllowed(request, env, enroll = false) {
  const user = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!user) return false;
  if (env.ADMIN_EMAIL && email?.toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase()) return true;
  if (enroll && env.OWNER_PRIVATE_SETUP === "true") {
    await run(env, "INSERT OR IGNORE INTO store_owner(lock_id,user_id) VALUES(1,?)", user);
  }
  const owner = await first(env, "SELECT user_id FROM store_owner WHERE lock_id=1");
  return owner?.user_id === user;
}
function clientOrigin(request, url) {
  check(request.headers.get("origin") === url.origin && request.headers.get("sec-fetch-site") !== "cross-site", "Хүсэлтийг зөвшөөрсөнгүй.", 403);
}

async function catalog(env, admin = false) {
  const [products, variants, looks] = await Promise.all([
    rows(env, "SELECT * FROM products" + (admin ? "" : " WHERE active = 1") + " ORDER BY position, rowid DESC"),
    rows(env, "SELECT * FROM variants" + (admin ? "" : " WHERE active = 1") + " ORDER BY rowid"),
    rows(env, "SELECT * FROM looks" + (admin ? "" : " WHERE active = 1") + " ORDER BY position, rowid DESC")
  ]);
  const byProduct = new Map();
  for (const variant of variants) {
    const list = byProduct.get(variant.product_id) ?? [];
    list.push(variant);
    byProduct.set(variant.product_id, list);
  }
  const items = products.map(product => ({ ...product, variants: byProduct.get(product.id) ?? [] }))
    .filter(product => admin || product.variants.length);
  const ids = new Set(items.map(product => product.id));
  return {
    products: items, regions, checkout: checkoutReady(env),
    looks: looks.map(look => ({ ...look, pins: JSON.parse(look.pins).filter(pin => admin || ids.has(pin.product)) }))
      .filter(look => admin || look.pins.length)
  };
}

// Optional garment measurements in cm: { columns:["Цээж","Урт"], rows:[{ size:"M", values:[56, 72] }] }.
// Empty cells are null. Stored as JSON text; "" means the product has no chart.
function sizeChart(value) {
  if (value == null || value === "") return "";
  check(value && typeof value === "object" && Array.isArray(value.columns) && Array.isArray(value.rows), "Хэмжээний хүснэгт буруу байна.");
  const columns = value.columns.map(column => textField(column, 24));
  check(columns.length >= 1 && columns.length <= 6 && value.rows.length >= 1 && value.rows.length <= 30, "Хэмжээний хүснэгт буруу байна.");
  const rows = value.rows.map(row => {
    check(row && Array.isArray(row.values) && row.values.length === columns.length, "Хэмжээний хүснэгт буруу байна.");
    return { size: textField(row.size, 35), values: row.values.map(cell => {
      if (cell === null) return null;
      check(Number.isFinite(cell) && cell > 0 && cell <= 400, "Хэмжээ 0–400 см хооронд байна.");
      return Math.round(cell * 10) / 10;
    }) };
  });
  check(rows.some(row => row.values.some(cell => cell !== null)), "Хэмжээний хүснэгтэд дор хаяж нэг тоо оруулна уу.");
  return JSON.stringify({ columns, rows });
}
async function saveProduct(env, data) {
  const id = data.id ?? crypto.randomUUID();
  check(uuid.test(id) && categories.includes(data.category) && typeof data.active === "boolean");
  const title = textField(data.title, 100), brand = textField(data.brand, 80);
  const description = textField(data.description ?? "", 2500, 0);
  const image = textField(data.image ?? "", 60, 0);
  const frontImage = textField(data.front_image ?? "", 60, 0);
  const chart = sizeChart(data.size_chart), fitNote = textField(data.fit_note ?? "", 200, 0);
  check(!image || imageKey.test(image));
  check(!frontImage || imageKey.test(frontImage));
  check(!data.active || Boolean(image), "Бараа нийтлэхийн өмнө зураг оруулна уу.");
  check(Array.isArray(data.variants) && data.variants.length > 0 && data.variants.length <= 30, "Хэмжээ, өнгө, үнээ оруулна уу.");
  const variants = data.variants.map(item => {
    check(item && typeof item.active === "boolean" && (item.id == null || uuid.test(item.id)));
    return {
      id: item.id ?? crypto.randomUUID(), existing: item.id != null, version: item.id == null ? 0 : integer(item.version, 0, 2 ** 31 - 1),
      size: textField(item.size, 35), color: textField(item.color, 35),
      price: integer(item.price, 1, 1_000_000_000), stock: integer(item.stock, 0, 1_000_000), active: Number(item.active)
    };
  });
  check(new Set(variants.map(item => item.id)).size === variants.length);
  check(new Set(variants.filter(item => item.active).map(item => JSON.stringify([item.size.toLowerCase(), item.color.toLowerCase()]))).size ===
    variants.filter(item => item.active).length, "Ижил хэмжээ, өнгөтэй сонголт давхардсан байна.");
  check(!data.active || variants.some(item => item.active), "Дор хаяж нэг идэвхтэй сонголт нэмнэ үү.");
  try {
    const writes = [statement(env, "INSERT INTO products(id,title,brand,description,category,image,front_image,active,size_chart,fit_note,position) VALUES(?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MIN(position),0)-1 FROM products)) ON CONFLICT(id) DO UPDATE SET title=excluded.title, brand=excluded.brand, description=excluded.description, category=excluded.category, image=excluded.image, front_image=excluded.front_image, active=excluded.active, size_chart=excluded.size_chart, fit_note=excluded.fit_note",
      id, title, brand, description, data.category, image, frontImage, Number(data.active), chart, fitNote)];
    for (const item of variants) {
      if (item.existing) {
        writes.push(statement(env, "UPDATE variants SET size=?,color=?,price=?,stock=?,active=?,version=version+1 WHERE id=? AND product_id=? AND version=?",
          item.size, item.color, item.price, item.stock, item.active, item.id, id, item.version));
        writes.push(statement(env, "INSERT INTO admin_write_guard(ok) VALUES(changes())"));
      } else {
        writes.push(statement(env, "INSERT INTO variants(id,product_id,size,color,price,stock,active) VALUES(?,?,?,?,?,?,?)",
          item.id, id, item.size, item.color, item.price, item.stock, item.active));
      }
    }
    await env.DB.batch(writes);
  } catch (error) {
    if (/CHECK constraint failed.*ok/i.test(String(error))) throw new HttpError(409, "Үлдэгдэл өөрчлөгдсөн. Хуудсаа шинэчилж дахин оролдоно уу.");
    throw error;
  }
  return { id };
}

// Sets the storefront order: ids are listed top (first on the rack) to bottom.
async function reorder(env, data) {
  check(["products", "looks"].includes(data.kind) && Array.isArray(data.ids) && data.ids.length >= 1 && data.ids.length <= 500);
  check(data.ids.every(id => uuid.test(id)) && new Set(data.ids).size === data.ids.length);
  await env.DB.batch(data.ids.map((id, index) => statement(env, "UPDATE " + data.kind + " SET position=? WHERE id=?", index, id)));
  return { ok: true };
}
// A product that was ever ordered stays in the database (orders point at its variants); hide it as a draft instead.
async function deleteProduct(env, data) {
  check(uuid.test(data.id));
  check(await first(env, "SELECT id FROM products WHERE id=?", data.id), "Бараа олдсонгүй.", 404);
  const ordered = await first(env, "SELECT 1 AS hit FROM order_items i JOIN variants v ON v.id=i.variant_id WHERE v.product_id=? LIMIT 1", data.id);
  check(!ordered, "Энэ бараа захиалгад орсон тул устгах боломжгүй. Оронд нь «Дэлгүүрт харуулах»-ыг болиулж ноорог болгоно уу.", 409);
  const writes = [];
  for (const look of await rows(env, "SELECT id,pins FROM looks")) {
    const pins = JSON.parse(look.pins);
    const kept = pins.filter(pin => pin.product !== data.id);
    if (kept.length !== pins.length) {
      writes.push(statement(env, "UPDATE looks SET pins=?, active=CASE WHEN ?=0 THEN 0 ELSE active END WHERE id=?", JSON.stringify(kept), kept.length, look.id));
    }
  }
  writes.push(statement(env, "DELETE FROM variants WHERE product_id=?", data.id), statement(env, "DELETE FROM products WHERE id=?", data.id));
  await env.DB.batch(writes);
  return { ok: true };
}
async function saveLook(env, data) {
  const id = data.id ?? crypto.randomUUID();
  check(uuid.test(id) && typeof data.active === "boolean" && imageKey.test(data.image));
  const title = textField(data.title, 100);
  check(Array.isArray(data.pins) && data.pins.length >= 1 && data.pins.length <= 8);
  const pins = [];
  for (const pin of data.pins) {
    check(pin && uuid.test(pin.product) && Number.isFinite(pin.x) && pin.x >= 0 && pin.x <= 100 && Number.isFinite(pin.y) && pin.y >= 0 && pin.y <= 100);
    check(await first(env, "SELECT id FROM products WHERE id=?", pin.product), "Бараа олдсонгүй.");
    pins.push({ product: pin.product, x: pin.x, y: pin.y });
  }
  await run(env, "INSERT INTO looks(id,title,image,pins,active,position) VALUES(?,?,?,?,?,(SELECT COALESCE(MIN(position),0)-1 FROM looks)) ON CONFLICT(id) DO UPDATE SET title=excluded.title,image=excluded.image,pins=excluded.pins,active=excluded.active",
    id, title, data.image, JSON.stringify(pins), Number(data.active));
  return { id };
}

async function uploadImage(request, env) {
  const type = request.headers.get("content-type");
  const ext = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
  check(ext, "WebP, JPEG эсвэл PNG зураг оруулна уу.");
  const bytes = await readBody(request, 4_000_000);
  const bytesMatch = (offset, signature) => signature.every((byte, index) => bytes[offset + index] === byte);
  const valid = ext === "jpg" ? bytesMatch(0, [255,216,255]) : ext === "png" ?
    bytesMatch(0, [137,80,78,71,13,10,26,10]) : bytesMatch(0, [82,73,70,70]) && bytesMatch(8, [87,69,66,80]);
  check(valid, "Зураг унших боломжгүй байна.");
  const key = crypto.randomUUID() + "." + ext;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  return { key };
}

function validatedCheckout(data) {
  check(uuid.test(data.id) && regions.includes(data.province) && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 15);
  const phone = textField(data.phone, 18).replace(/[\s-]/g, "").replace(/^\+976/, "");
  check(/^\d{8}$/.test(phone), "Монгол утасны дугаараа шалгана уу.");
  const items = data.items.map(item => {
    check(item && uuid.test(item.id));
    return { id: item.id, quantity: integer(item.quantity, 1, 10) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  check(new Set(items.map(item => item.id)).size === items.length);
  return { id: data.id, buyer: textField(data.buyer, 100, 2), phone, province: data.province, address: textField(data.address, 350, 6), items };
}
async function reserveOrder(env, data, fingerprint, shopperKey) {
  const selected = await rows(env, "SELECT v.*,p.title,p.brand FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.active=1 AND v.id IN (" + data.items.map(() => "?").join(",") + ")", ...data.items.map(item => item.id));
  const variants = new Map(selected.map(item => [item.id, item]));
  let amount = 0;
  const itemWrites = data.items.map(item => {
    const variant = variants.get(item.id);
    check(variant && variant.stock >= item.quantity, "Зарим барааны үлдэгдэл хүрэлцэхгүй байна.", 409);
    amount += variant.price * item.quantity;
    return statement(env, "INSERT INTO order_items(order_id,variant_id,title,brand,size,color,price,quantity) VALUES(?,?,?,?,?,?,?,?)",
      data.id, variant.id, variant.title, variant.brand, variant.size, variant.color, variant.price, item.quantity);
  });
  integer(amount, 1, 1_000_000_000);
  const now = nowSeconds();
  try {
    await env.DB.batch([
      statement(env, "INSERT INTO orders(id,fingerprint,created,expires,status,amount,buyer,phone,province,address,shopper_key) VALUES(?,?,?,?,'pending',?,?,?,?,?,?)",
        data.id, fingerprint, now, now + 1800, amount, data.buyer, data.phone, data.province, data.address, shopperKey),
      ...itemWrites
    ]);
  } catch (error) {
    const existing = await first(env, "SELECT * FROM orders WHERE id=?", data.id);
    if (existing) return existing;
    if (String(error).includes("stock_changed")) throw new HttpError(409, "Барааны үнэ эсвэл үлдэгдэл өөрчлөгдсөн.");
    if (String(error).includes("reservation_limit")) throw new HttpError(429, "Төлбөр хүлээгдэж буй захиалгуудаа шалгана уу.");
    throw error;
  }
  return first(env, "SELECT * FROM orders WHERE id=?", data.id);
}

async function applyPayment(env, order, intent) {
  check(intent.id === order.wire_id && intent.amount === order.amount && intent.currency === "MNT", "Төлбөрийн төлөв таарахгүй байна.", 409);
  if (intent.status === "succeeded" || intent.status === "canceled") {
    await run(env, "UPDATE orders SET status=? WHERE id=? AND status='pending'",
      intent.status === "succeeded" ? "paid" : "canceled", order.id);
  }
}
async function refreshOrder(env, order) {
  if (order.status !== "pending") return order;
  if (order.wire_id && env.WIRE_API_KEY) {
    const intent = await wireRequest(env, "/payment_intents/" + order.wire_id);
    await applyPayment(env, order, intent);
  } else if (!order.wire_id && order.expires <= nowSeconds()) {
    await run(env, "UPDATE orders SET status='canceled' WHERE id=? AND status='pending' AND wire_id IS NULL", order.id);
  }
  return first(env, "SELECT * FROM orders WHERE id=?", order.id);
}
async function reconcileExpired(env) {
  const pending = await rows(env, "SELECT * FROM orders WHERE status='pending' AND expires<=? ORDER BY expires LIMIT 8", nowSeconds());
  await Promise.allSettled(pending.map(order => refreshOrder(env, order)));
}
async function startCheckout(env, data, origin, address) {
  check(checkoutReady(env), "Онлайн төлбөр удахгүй нээгдэнэ.", 503);
  const checkout = validatedCheckout(data);
  const fingerprint = await hashHex(JSON.stringify(checkout));
  const shopperKey = address ? await hashHex(env.WIRE_WEBHOOK_SECRET + ":" + address) : null;
  const existing = await first(env, "SELECT * FROM orders WHERE id=?", checkout.id);
  const order = existing ?? await reserveOrder(env, checkout, fingerprint, shopperKey);
  check(order.fingerprint === fingerprint, "Захиалгын мэдээлэл өөрчлөгдсөн байна.", 409);
  if (order.status === "paid" || order.status === "shipped") return { url: origin + "/order/" + order.id };
  check(order.status === "pending" && order.expires > nowSeconds(), "Төлбөрийн хугацаа дууссан. Шинээр захиална уу.", 410);
  if (order.checkout_url) return { url: order.checkout_url };
  try {
    let paymentId = order.wire_id;
    if (!paymentId) {
      check(order.expires - nowSeconds() > 300, "Төлбөрийн хугацаа дуусаж байна. Хэсэг хугацааны дараа дахин оролдоно уу.", 410);
      const intent = await wireRequest(env, "/payment_intents", {
        amount: order.amount, currency: "MNT", description: "Repbish " + order.id.slice(0, 8),
        expires_at: order.expires, metadata: { order_id: order.id }
      }, order.id + "-intent");
      check(wireIdPattern.test(intent.id) && intent.currency === "MNT" && intent.amount === order.amount, "Төлбөрийн мэдээлэл таарахгүй байна.", 502);
      paymentId = intent.id;
      const saved = await run(env, "UPDATE orders SET wire_id=? WHERE id=? AND status='pending' AND (wire_id IS NULL OR wire_id=?)", paymentId, order.id, paymentId);
      check(saved.meta.changes, "Захиалга идэвхгүй болсон байна.", 409);
    }
    const orderUrl = origin + "/order/" + order.id;
    const session = await wireRequest(env, "/checkout/sessions", {
      payment_intent: paymentId, success_url: orderUrl, cancel_url: orderUrl
    }, order.id + "-checkout");
    const paymentUrl = new URL(session.url);
    check(paymentUrl.origin === "https://pay.wire.mn" && paymentUrl.pathname.startsWith("/c/") && session.payment_intent === paymentId, "Төлбөрийн хаяг буруу байна.", 502);
    await run(env, "UPDATE orders SET checkout_url=? WHERE id=? AND status='pending'", paymentUrl.href, order.id);
    return { url: paymentUrl.href };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Wire checkout unavailable:", error.message);
    throw new HttpError(502, "Wire төлбөр нээхэд алдаа гарлаа. Дахин оролдоно уу.");
  }
}

async function wireWebhook(request, env) {
  const body = await readBody(request, 65_536);
  check(await verifyWire(env.WIRE_WEBHOOK_SECRET, request.headers.get("WirePayment-Signature") ?? "", body), "Invalid signature", 400);
  const event = decodeJson(body);
  if (event?.type === "endpoint.verification") return json({ ok: true });
  if (event?.type === "payment_intent.succeeded" || event?.type === "payment_intent.canceled") {
    const intent = event.data;
    const expectedStatus = event.type === "payment_intent.succeeded" ? "succeeded" : "canceled";
    check(intent && wireIdPattern.test(intent.id) && intent.status === expectedStatus);
    const order = await first(env, "SELECT * FROM orders WHERE wire_id=?", intent.id);
    if (order) await applyPayment(env, order, intent);
  }
  return json({ ok: true });
}
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const productPath = /^[a-z0-9-]{1,64}$/;
// store information pages; their text lives in client.js
const infoTitles = { delivery: "Хүргэлт", returns: "Буцаалт, солилт", privacy: "Нууцлал", contact: "Холбоо барих" };
const siteDescription = "Оригинал брэндийн хувцас, боломжийн үнээр. Монгол даяар үнэгүй хүргэлт.";
const html = "text/html; charset=utf-8";
// Optional sub-path the store is served under (BASE_PATH, e.g. "/repbish"); "" at the domain root.
// Pages get <base href> so their relative links resolve under it, and absolute URLs include it.
let basePath = "";
const withBase = page => page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="' + escapeHtml(basePath + "/") + '">');

// Every storefront URL serves the same page; the server fills in that URL's title, description and
// share-preview tags so link previews (Facebook, Messenger, Telegram) and search engines see them without JavaScript.
function storePage({ title, description = siteDescription, url, image, type = "website", extra = [], robots }) {
  const tags = [
    robots && '<meta name="robots" content="' + robots + '">',
    url && '<link rel="canonical" href="' + escapeHtml(url) + '">',
    '<meta property="og:type" content="' + type + '">', '<meta property="og:site_name" content="Repbish">',
    '<meta property="og:locale" content="mn_MN">',
    '<meta property="og:title" content="' + escapeHtml(title) + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    url && '<meta property="og:url" content="' + escapeHtml(url) + '">',
    image && '<meta property="og:image" content="' + escapeHtml(image) + '">',
    image && '<meta property="og:image:alt" content="' + escapeHtml(title) + '">',
    '<meta name="twitter:card" content="' + (image ? "summary_large_image" : "summary") + '">',
    ...extra
  ].filter(Boolean).join("\n");
  return withBase(assets.shopHtml)
    .replace(/<title>[^<]*<\/title>/, "<title>" + escapeHtml(title === "Repbish" ? "Repbish — оригинал брэндийн хувцас" : title + " | Repbish") + "</title>")
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escapeHtml(description) + '">')
    .replace("</head>", tags + "\n</head>");
}
const mediaUrl = (origin, key) => origin + "/media/" + encodeURIComponent(key);
// the home page previews with the newest published product's photo
async function homePage(env, origin) {
  const latest = await first(env, "SELECT p.image, p.front_image FROM products p WHERE p.active=1 AND (p.front_image<>'' OR p.image<>'') " +
    "AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active=1) ORDER BY p.rowid DESC LIMIT 1");
  return response(storePage({ title: "Repbish", url: origin + "/",
    image: latest && mediaUrl(origin, latest.front_image || latest.image) }), html, 200, "public, max-age=60");
}
function infoPage(slug, origin) {
  return response(storePage({ title: infoTitles[slug], url: origin + "/info/" + slug }), html, 200, "public, max-age=300");
}
async function productPage(env, id, origin) {
  const product = uuid.test(id) ? await first(env, "SELECT * FROM products WHERE id=? AND active=1", id) : null;
  const offer = product && await first(env, "SELECT MIN(price) AS price, SUM(stock) AS stock, COUNT(*) AS count FROM variants WHERE product_id=? AND active=1", id);
  if (!product || !offer?.count) return response(storePage({ title: "Бараа олдсонгүй", robots: "noindex" }), html, 404);
  const url = origin + "/products/" + product.id;
  const image = mediaUrl(origin, product.front_image || product.image);
  const description = (product.description.replace(/\s+/g, " ").trim() || product.brand + " " + product.title + ". Монгол даяар үнэгүй хүргэлт.").slice(0, 200);
  const data = {
    "@context": "https://schema.org", "@type": "Product", name: product.title, brand: { "@type": "Brand", name: product.brand },
    description, image, url,
    offers: { "@type": "Offer", price: offer.price, priceCurrency: "MNT", url,
      availability: offer.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" }
  };
  return response(storePage({ title: product.title + " — " + product.brand, description, url, image, type: "product", extra: [
    '<meta property="product:price:amount" content="' + offer.price + '">', '<meta property="product:price:currency" content="MNT">',
    '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, "\\u003c") + '</script>'
  ] }), html, 200, "public, max-age=60");
}

// site icon: a black square with the lowercase "r" of the wordmark
const favicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111"/>' +
  '<path d="M22 50V22h7.4v4.6c1.9-3.5 4.9-5.4 9.2-5.4h2.4v7.2h-2.6c-5.4 0-9 2.6-9 9V50z" fill="#fff"/></svg>';
function robots(origin) {
  return "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /order/\n\nSitemap: " + origin + "/sitemap.xml\n";
}
async function sitemap(env, origin) {
  const products = await rows(env, "SELECT p.id FROM products p WHERE p.active=1 AND EXISTS " +
    "(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active=1) ORDER BY p.rowid DESC");
  const urls = [origin + "/", origin + "/products", ...Object.keys(infoTitles).map(slug => origin + "/info/" + slug), ...products.map(item => origin + "/products/" + item.id)];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(url => "  <url><loc>" + escapeHtml(url) + "</loc></url>").join("\n") + "\n</urlset>\n";
}
async function adminOrders(env) {
  const orders = await rows(env, "SELECT id,created,status,amount,buyer,phone,province,address,tracking FROM orders ORDER BY created DESC LIMIT 100");
  if (!orders.length) return orders;
  const items = await rows(env, "SELECT * FROM order_items WHERE order_id IN (" + orders.map(() => "?").join(",") + ")", ...orders.map(order => order.id));
  return orders.map(order => ({ ...order, items: items.filter(item => item.order_id === order.id) }));
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      basePath = String(env.BASE_PATH ?? "").replace(/\/+$/, "");
      const site = url.origin + basePath;
      const path = url.pathname;
      const method = request.method;
      const route = path.split("/");
      if (method === "GET" && path === "/") return await homePage(env, site);
      if (method === "GET" && route.length === 3 && route[1] === "order" && uuid.test(route[2])) {
        return response(storePage({ title: "Захиалгын төлөв", robots: "noindex" }), html);
      }
      if (method === "GET" && route.length === 3 && route[1] === "fonts" && route[2].endsWith(".woff2") && Object.hasOwn(assets.fonts, route[2].slice(0, -6))) {
        return response(Uint8Array.from(atob(assets.fonts[route[2].slice(0, -6)]), char => char.charCodeAt(0)), "font/woff2", 200, "public, max-age=31536000, immutable");
      }
      if (method === "GET" && path === "/favicon.svg") return response(favicon, "image/svg+xml", 200, "public, max-age=86400");
      if (method === "GET" && path === "/robots.txt") return response(robots(site), "text/plain; charset=utf-8", 200, "public, max-age=3600");
      if (method === "GET" && path === "/sitemap.xml") return response(await sitemap(env, site), "application/xml; charset=utf-8", 200, "public, max-age=3600");
      if (method === "GET" && route.length === 3 && route[1] === "info" && Object.hasOwn(infoTitles, route[2])) return infoPage(route[2], site);
      if (method === "GET" && path === "/products") {
        return response(storePage({ title: "Бүх бараа", url: site + "/products",
          description: "Repbish-ийн бүх бараа: оригинал брэндийн хувцас, боломжийн үнээр. Монгол даяар үнэгүй хүргэлт." }), html, 200, "public, max-age=60");
      }
      if (method === "GET" && route.length === 3 && route[1] === "products" && productPath.test(route[2])) {
        return await productPage(env, route[2], site);
      }
      if (method === "GET" && path === "/style.css") return response(assets.storeCss, "text/css; charset=utf-8");
      if (method === "GET" && path === "/shop.js") return response(assets.clientJs, "text/javascript; charset=utf-8");
      if (method === "GET" && path === "/admin.js") return response(assets.adminJs, "text/javascript; charset=utf-8");
      if (method === "GET" && route.length === 3 && route[1] === "demo" && Object.hasOwn(assets.demo, route[2])) {
        return response(Uint8Array.from(atob(assets.demo[route[2]]), char => char.charCodeAt(0)), "image/webp", 200, "public, max-age=86400");
      }
      if (method === "GET" && path === "/admin") {
        if (!request.headers.get("oai-authenticated-user-id")) return Response.redirect(url.origin + "/signin-with-chatgpt?return_to=%2Fadmin", 302);
        check(await adminAllowed(request, env, true), "Админ хандах эрхгүй байна.", 403);
        return response(withBase(assets.adminHtml), "text/html; charset=utf-8");
      }
      if (method === "GET" && route.length === 3 && route[1] === "media" && imageKey.test(route[2])) {
        const image = await env.BUCKET.get(route[2]);
        check(image, "Зураг олдсонгүй.", 404);
        return response(image.body, image.httpMetadata.contentType, 200, "public, max-age=31536000, immutable");
      }
      if (method === "GET" && path === "/api/catalog") return json(await catalog(env));
      if (method === "POST" && path === "/api/checkout") {
        clientOrigin(request, url);
        if (checkoutReady(env)) ctx?.waitUntil(reconcileExpired(env));
        return json(await startCheckout(env, await requestJson(request), site, request.headers.get("CF-Connecting-IP")));
      }
      if (method === "POST" && path === "/webhooks/wire") return await wireWebhook(request, env);
      if (method === "GET" && route.length === 4 && route[2] === "orders" && route[1] === "api" && uuid.test(route[3])) {
        let order = await first(env, "SELECT * FROM orders WHERE id=?", route[3]);
        check(order, "Захиалга олдсонгүй.", 404);
        try { order = await refreshOrder(env, order); } catch { /* Signed events can reconcile independently. */ }
        return json({ id: order.id, status: order.status, amount: order.amount, tracking: order.tracking,
          payment: order.status === "pending" && order.expires > nowSeconds() ? order.checkout_url : null });
      }
      if (path.startsWith("/api/admin/")) {
        check(await adminAllowed(request, env), "Хандах эрхгүй байна.", 403);
        if (method === "POST") clientOrigin(request, url);
        if (method === "GET" && path === "/api/admin/catalog") return json(await catalog(env, true));
        if (method === "GET" && path === "/api/admin/orders") {
          ctx?.waitUntil(reconcileExpired(env));
          return json(await adminOrders(env));
        }
        if (method === "POST" && path === "/api/admin/image") return json(await uploadImage(request, env), 201);
        if (method === "POST" && path === "/api/admin/product") return json(await saveProduct(env, await requestJson(request)));
        if (method === "POST" && path === "/api/admin/look") return json(await saveLook(env, await requestJson(request)));
        if (method === "POST" && path === "/api/admin/reorder") return json(await reorder(env, await requestJson(request)));
        if (method === "POST" && path === "/api/admin/delete-product") return json(await deleteProduct(env, await requestJson(request)));
        if (method === "POST" && path === "/api/admin/delete-look") {
          const data = await requestJson(request);
          check(uuid.test(data.id));
          check((await run(env, "DELETE FROM looks WHERE id=?", data.id)).meta.changes, "Хослол олдсонгүй.", 404);
          return json({ ok: true });
        }
        if (method === "POST" && path === "/api/admin/ship") {
          const data = await requestJson(request);
          check(uuid.test(data.id));
          const order = await first(env, "SELECT * FROM orders WHERE id=? AND status='paid'", data.id);
          check(order && env.WIRE_API_KEY, "Баталгаажсан төлбөртэй захиалга олдсонгүй.", 409);
          const intent = await wireRequest(env, "/payment_intents/" + order.wire_id);
          check(intent.status === "succeeded" && intent.id === order.wire_id && intent.amount === order.amount && intent.currency === "MNT", "Төлбөр баталгаажаагүй байна.", 409);
          const tracking = textField(data.tracking ?? "", 100, 0) || null;
          const saved = await run(env, "UPDATE orders SET status='shipped',tracking=? WHERE id=? AND status='paid'", tracking, data.id);
          check(saved.meta.changes, "Захиалгын төлөв өөрчлөгдсөн байна.", 409);
          return json({ ok: true });
        }
      }
      return json({ error: "Хуудас олдсонгүй." }, 404);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("Repbish request error:", error.message);
      return json({ error: error instanceof HttpError ? error.message : "Түр алдаа гарлаа. Дахин оролдоно уу." }, error.status ?? 500);
    }
  }
};
