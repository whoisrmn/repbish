import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { localDb } from "./local-db.mjs";
import worker from "./dist/server/index.js";

const origin = "https://repbish.test";
const owner = { "oai-authenticated-user-id":"owner-test", "oai-authenticated-user-email":"ignored@repbish.test" };
const context = { waitUntil(promise) { promise.catch(() => {}); } };
const testSecret = "whsec_fixture";
const environment = () => ({
  DB:localDb(), OWNER_PRIVATE_SETUP:"true", WIRE_WEBHOOK_SECRET:testSecret,
  WIRE_API_KEY:"fixture", CHECKOUT_ENABLED:"true", BUCKET:{ put:async () => {} }
});
function call(env, path, { method = "GET", headers = {}, data, raw } = {}) {
  const body = raw ?? (data === undefined ? undefined : JSON.stringify(data));
  return worker.fetch(new Request(origin + path, {
    method, headers:{ origin, "content-type":"application/json", ...headers }, body
  }), env, context);
}
const post = (env, path, data, headers = {}) => call(env, path, { method:"POST", data, headers });
const setupOwner = env => call(env, "/admin", { headers:owner });
const upload = env => readFile(new URL("./src/demo/hanger-HOODIE.webp", import.meta.url)).then(raw =>
  call(env, "/api/admin/image", { method:"POST", headers:{ ...owner, "content-type":"image/webp" }, raw }));

async function newProduct(env, stock = 2) {
  const image = (await (await upload(env)).json()).key;
  const draft = {
    title:"Test Tee", brand:"Brand", category:"tops", image, active:true,
    variants:[{ size:"M", color:"Black", price:59000, stock, active:true }]
  };
  assert.equal((await post(env, "/api/admin/product", draft, owner)).status, 200);
  const data = await (await call(env, "/api/catalog")).json();
  return data.products[0];
}
function buyer(id, variant, quantity = 1) {
  return { id, buyer:"Fixture Buyer", phone:"+976 99112233", province:"Улаанбаатар", address:"Test delivery address",
    items:[{ id:variant, quantity }] };
}
function wireEvent(env, type, intent, signatureOverride) {
  const raw = JSON.stringify({ id:"evt_fixture", type, data:intent });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signatureOverride ?? createHmac("sha256",testSecret).update(timestamp + "." + raw).digest("hex");
  return call(env,"/webhooks/wire",{ method:"POST", raw, headers:{ "WirePayment-Signature":"t=" + timestamp + ",v1=" + signature } });
}

test("owner enrollment and catalog editing protect admin and publish linked looks", async () => {
  const env = environment();
  assert.equal((await call(env,"/api/admin/catalog")).status,403);
  assert.equal((await setupOwner(env)).status,200);
  assert.equal((await call(env,"/admin",{ headers:{ "oai-authenticated-user-id":"different-account" } })).status,403);
  const product = await newProduct(env);
  assert.equal(product.variants[0].stock,2);
  const saved = await post(env,"/api/admin/look", { title:"Look", image:product.image, active:true, pins:[{ product:product.id, x:30,y:40 }] },owner);
  assert.equal(saved.status,200);
  const data = await (await call(env,"/api/catalog")).json();
  assert.equal(data.looks[0].pins[0].product,product.id);
  assert.equal((await post(env,"/api/admin/product",{}, { ...owner, origin:"https://elsewhere.test" })).status,403);
});

test("Wire checkout reserves stock, replays safely and only trusts verified payment", async t => {
  const env = environment();
  const intents = new Map();
  let creates = 0;
  t.mock.method(globalThis,"fetch",async (url, options) => {
    assert.match(url,/^https:\/\/api\.wire\.mn\/v1\//);
    const path = new URL(url).pathname;
    if (path.endsWith("/payment_intents")) {
      creates++;
      const data = JSON.parse(options.body);
      assert.equal(data.amount,59000);
      assert.equal(data.currency,"MNT");
      const intent = { id:"pi_fixture" + creates, amount:data.amount, currency:"MNT", status:"requires_payment_method" };
      intents.set(intent.id,intent);
      return Response.json(intent);
    }
    if (path.endsWith("/checkout/sessions")) {
      const data = JSON.parse(options.body);
      assert.match(data.success_url,/^https:\/\/repbish\.test\/order\//);
      return Response.json({ payment_intent:data.payment_intent, url:"https://pay.wire.mn/c/fixture" });
    }
    return Response.json(intents.get(path.split("/").at(-1)));
  });
  assert.equal((await setupOwner(env)).status,200);
  const product = await newProduct(env,1);
  const variant = product.variants[0];
  const id = crypto.randomUUID();
  const request = buyer(id,variant.id);
  assert.equal((await post({ ...env,CHECKOUT_ENABLED:"false" },"/api/checkout",request)).status,503);
  const paidOrder = await post(env,"/api/checkout",request);
  assert.equal(paidOrder.status,200,JSON.stringify(await paidOrder.clone().json()));
  assert.equal((await paidOrder.json()).url,"https://pay.wire.mn/c/fixture");
  assert.equal((await post(env,"/api/checkout",request)).status,200);
  assert.equal(creates,1);
  assert.equal((await post(env,"/api/checkout",buyer(crypto.randomUUID(),variant.id))).status,409);
  const stale = await post(env,"/api/admin/product", { ...product, active:true, variants:[{ ...variant, active:true, stock:4 }] },owner);
  assert.equal(stale.status,409);
  const intent = intents.get("pi_fixture1");
  assert.equal((await wireEvent(env,"payment_intent.succeeded",{ ...intent,status:"succeeded" },"f".repeat(64))).status,400);
  assert.equal((await (await call(env,"/api/orders/" + id)).json()).status,"pending");
  intent.status = "canceled";
  assert.equal((await wireEvent(env,"payment_intent.canceled",intent)).status,200);
  assert.equal((await wireEvent(env,"payment_intent.canceled",intent)).status,200);
  assert.equal((await (await call(env,"/api/catalog")).json()).products[0].variants[0].stock,1);
  const nextId = crypto.randomUUID();
  assert.equal((await post(env,"/api/checkout",buyer(nextId,variant.id))).status,200);
  const nextIntent = intents.get("pi_fixture2");
  nextIntent.status = "succeeded";
  assert.equal((await wireEvent(env,"payment_intent.succeeded",{ ...nextIntent,amount:1 })).status,409);
  assert.equal((await wireEvent(env,"payment_intent.succeeded",nextIntent)).status,200);
  assert.equal((await post(env,"/api/admin/ship",{ id:nextId,tracking:"TRACK-1" },owner)).status,200);
  const result = await (await call(env,"/api/orders/" + nextId)).json();
  assert.equal(result.status,"shipped");
  assert.equal(result.tracking,"TRACK-1");
  assert.equal("phone" in result,false);
});

test("product pages carry their own title and share-preview tags, and hide drafts", async () => {
  const env = environment();
  await setupOwner(env);
  const product = await newProduct(env, 0);
  const page = await call(env, "/products/" + product.id);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Test Tee — Brand \| Repbish<\/title>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/repbish\.test\/media\/[a-f0-9-]+\.webp">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/repbish\.test\/products\//);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(data.offers.price, 59000);
  assert.equal(data.offers.availability, "https://schema.org/OutOfStock");
  assert.equal((await call(env, "/products/00000000-0000-4000-8000-000000000000")).status, 404);
  const hidden = { id:product.id, title:product.title, brand:product.brand, category:product.category, image:product.image, active:false,
    variants:product.variants.map(({ id, version, size, color, price, stock }) => ({ id, version, size, color, price, stock, active:true })) };
  assert.equal((await post(env, "/api/admin/product", hidden, owner)).status, 200);
  const draft = await call(env, "/products/" + product.id);
  assert.equal(draft.status, 404);
  assert.match(await draft.text(), /<meta name="robots" content="noindex">/);
});

test("store information pages are served with their own titles", async () => {
  const env = environment();
  for (const [slug, title] of [["delivery","Хүргэлт"],["returns","Буцаалт, солилт"],["privacy","Нууцлал"],["contact","Холбоо барих"]]) {
    const page = await call(env, "/info/" + slug);
    assert.equal(page.status, 200);
    assert.match(await page.text(), new RegExp("<title>" + title + " \| Repbish</title>"));
  }
  assert.equal((await call(env, "/info/unknown")).status, 404);
});
