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
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
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
    rows(env, "SELECT * FROM products" + (admin ? "" : " WHERE active = 1") + " ORDER BY rowid DESC"),
    rows(env, "SELECT * FROM variants" + (admin ? "" : " WHERE active = 1") + " ORDER BY rowid"),
    rows(env, "SELECT * FROM looks" + (admin ? "" : " WHERE active = 1") + " ORDER BY rowid DESC")
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

async function saveProduct(env, data) {
  const id = data.id ?? crypto.randomUUID();
  check(uuid.test(id) && categories.includes(data.category) && typeof data.active === "boolean");
  const title = textField(data.title, 100), brand = textField(data.brand, 80);
  const description = textField(data.description ?? "", 2500, 0);
  const image = textField(data.image ?? "", 60, 0);
  const frontImage = textField(data.front_image ?? "", 60, 0);
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
    const writes = [statement(env, "INSERT INTO products(id,title,brand,description,category,image,front_image,active) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, brand=excluded.brand, description=excluded.description, category=excluded.category, image=excluded.image, front_image=excluded.front_image, active=excluded.active",
      id, title, brand, description, data.category, image, frontImage, Number(data.active))];
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
  await run(env, "INSERT INTO looks(id,title,image,pins,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,image=excluded.image,pins=excluded.pins,active=excluded.active",
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
      const path = url.pathname;
      const method = request.method;
      const route = path.split("/");
      if (method === "GET" && (path === "/" || (route.length === 3 && route[1] === "order" && uuid.test(route[2])))) {
        return response(assets.shopHtml, "text/html; charset=utf-8");
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
        return response(assets.adminHtml, "text/html; charset=utf-8");
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
        return json(await startCheckout(env, await requestJson(request), url.origin, request.headers.get("CF-Connecting-IP")));
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
