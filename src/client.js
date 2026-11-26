const $ = selector => document.querySelector(selector);
const money = amount => new Intl.NumberFormat("mn-MN").format(amount) + " ₮";
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const media = (image, demo) => (demo ? "/demo/" : "/media/") + encodeURIComponent(image);
const labels = { all:"Бүгд", tops:"Дээгүүр", bottoms:"Өмд", outerwear:"Гадуур хувцас", accessories:"Аксессуар" };
const productDialog = $("#product-dialog");
const bagDialog = $("#bag-dialog");
const checkoutDialog = $("#checkout-dialog");
const checkoutForm = $("#checkout-form");
const rail = $("#rail");
let products = [];
let looks = [];
let regions = [];
let checkout = false;
let lookIndex = 0;
let attempt = null;
const demos = [
  ["hoodie","Box Hoodie","tops",89900,"Bordeaux","hanger-HOODIE"],
  ["tee","Heavyweight Tee","tops",39900,"Ivory","hanger-TEE"],
  ["trousers","Utility Trousers","bottoms",79900,"Charcoal","hanger-TROUSERS"],
  ["cap","Washed Cap","accessories",29900,"Washed Black","hanger-CAP"]
].map(([id,title,category,price,color,image]) => ({
  id,title,category,image,brand:"Жишээ бүтээгдэхүүн",description:"Өлгүүрийн харагдацыг үзүүлэх жишээ.",
  demo:true,variants:[{ id, price, color, size:"M", stock:0 }]
}));
const demoLook = {
  title:"Улаанбаатарын өдөр тутам", image:"look", demo:true,
  pins:[{ product:"hoodie", x:26, y:45 }, { product:"trousers", x:32, y:82 }]
};
function loadCart() {
  try {
    const data = JSON.parse(localStorage.getItem("repbish-cart-v1") ?? "[]");
    return new Map(data.filter(item => Array.isArray(item) && typeof item[0] === "string" && Number.isInteger(item[1]) && item[1] > 0 && item[1] <= 10));
  } catch { return new Map(); }
}
const cart = loadCart();
const priceOf = product => Math.min(...product.variants.map(variant => variant.price));
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? "Дахин оролдоно уу.");
    error.status = response.status;
    throw error;
  }
  return data;
}
function saveCart() {
  try { localStorage.setItem("repbish-cart-v1", JSON.stringify([...cart])); } catch {}
  $("#bag-count").textContent = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
}
function garment(product, index) {
  const src = esc(media(product.image, product.demo));
  const qty = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
  const tag = product.demo || qty ? money(priceOf(product)) : "Дууссан";
  return '<button type="button" class="garment" data-product="' + esc(product.id) + '" data-category="' + esc(product.category) +
    '"><span class="garment-photo"><img class="garment-regular" alt="" decoding="async"' + (index >= 5 ? ' loading="lazy"' : '') + ' src="' + src +
    '"><span class="tag">' + tag + '</span></span><span class="garment-label">' + esc(product.title) +
    '</span><span class="garment-brand">' + esc(product.brand) + '</span></button>';
}
function showRail() {
  if (products.length >= 5) {
    rail.style.setProperty("--rail-columns", 5);
    rail.style.setProperty("--rail-gap", "48px");
  }
  const categories = Object.entries(labels).filter(([key]) => key === "all" || products.some(product => product.category === key));
  $("#filters").innerHTML = categories.map(([key, label]) =>
    '<button type="button" data-category="' + key + '" aria-pressed="' + (key === "all") + '">' + label + '</button>').join("");
  rail.innerHTML = products.map(garment).join("");
  for (const card of rail.children) {
    const product = products.find(item => item.id === card.dataset.product);
    if (!product.front_image) continue;
    const loadFront = () => {
      const photo = card.querySelector(".garment-photo");
      if (photo.querySelector(".garment-front")) return;
      const img = document.createElement("img");
      img.className = "garment-front";
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("load", () => photo.classList.add("front-ready"), { once:true });
      img.src = media(product.front_image);
      photo.prepend(img);
    };
    card.addEventListener("pointerenter", loadFront, { once:true });
    card.addEventListener("focus", loadFront, { once:true });
  }
}
function showLook() {
  const look = looks[lookIndex];
  $("#look-navigation").hidden = looks.length < 2;
  $("#look-count").textContent = (lookIndex + 1) + " / " + looks.length;
  if (!look) {
    $("#look-content").textContent = "Шинэ хослол удахгүй нэмэгдэнэ.";
    return;
  }
  const pins = look.pins.map(pin => ({ ...pin, item:products.find(product => product.id === pin.product) })).filter(pin => pin.item);
  const dots = pins.map(({ x,y,item }, index) =>
    '<button type="button" class="hotspot" style="left:' + x + '%;top:' + y + '%" data-product="' + esc(item.id) +
    '" aria-label="' + esc(item.title) + '">' + (index + 1) + '</button>').join("");
  const list = [...new Set(pins.map(pin => pin.item))].map(item =>
    '<button type="button" class="look-item" data-product="' + esc(item.id) + '"><span>' + esc(item.title) +
    '</span><span>' + money(priceOf(item)) + '</span></button>').join("");
  $("#look-content").innerHTML = '<div class="look-layout"><div class="look-photo"><img loading="lazy" decoding="async" alt="' + esc(look.title) +
    '" src="' + esc(media(look.image, look.demo)) + '">' + dots + '</div><div class="look-products"><h3>' + esc(look.title) +
    '</h3>' + list + '</div></div>';
}
function details(product) {
  const options = product.variants.map(variant =>
    '<option value="' + esc(variant.id) + '"' + (!variant.stock && !product.demo ? " disabled" : "") + '>' + esc(variant.size) +
    ' / ' + esc(variant.color) + ' · ' + money(variant.price) + (!variant.stock && !product.demo ? " · Дууссан" : "") + '</option>').join("");
  const purchasable = product.variants.some(variant => variant.stock);
  $("#product-title").textContent = product.title;
  $("#product-content").innerHTML = '<div class="product-layout"><img alt="' + esc(product.title) + '" src="' +
    esc(media(product.front_image || product.image, product.demo)) + '"><div><p class="overline">' + esc(product.brand) +
    '</p><p>' + esc(product.description) + '</p><form id="product-options" class="form-grid"><label>Хэмжээ, өнгө<select name="variant"' +
    (!purchasable && !product.demo ? " disabled" : "") + '>' + options + '</select></label><strong id="variant-price" class="detail-price"></strong>' +
    (product.demo ? '<p class="muted">Дэлгүүрийн загварыг үзүүлэх жишээ.</p>' : '<button class="primary" type="submit"' +
      (!purchasable ? ' disabled>Дууссан' : '>Сагсанд нэмэх') + '</button>') + '</form></div></div>';
  const form = $("#product-options");
  const select = form.elements.variant;
  const showPrice = () => {
    const item = product.variants.find(variant => variant.id === select.value);
    $("#variant-price").textContent = money(item?.price ?? priceOf(product));
  };
  showPrice();
  select.addEventListener("change", showPrice);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const variant = product.variants.find(item => item.id === select.value);
    if (!variant?.stock || product.demo) return;
    const count = cart.get(variant.id) ?? 0;
    if (count < Math.min(variant.stock, 10)) cart.set(variant.id, count + 1);
    saveCart();
    productDialog.close();
    openBag();
    $("#announcement").textContent = product.title + " сагсанд нэмэгдлээ.";
  });
  productDialog.showModal();
}
function cartRows() {
  const selection = [];
  for (const product of products) {
    if (product.demo) continue;
    for (const variant of product.variants) {
      if (cart.has(variant.id)) selection.push({ product, variant, quantity:cart.get(variant.id) });
    }
  }
  return selection;
}
function updateBag(previous) {
  const items = cartRows();
  const total = items.reduce((sum,row) => sum + row.variant.price * row.quantity, 0);
  const canCheckout = items.every(row => row.quantity <= row.variant.stock);
  const content = $("#bag-content");
  content.innerHTML = items.length ? items.map(({ product, variant, quantity }) =>
    '<div class="basket-row"><img alt="" src="' + esc(media(product.image)) + '"><div><strong>' + esc(product.title) +
    '</strong><p class="muted">' + esc(variant.size) + ' / ' + esc(variant.color) + '</p><div class="quantity"><button type="button" data-change="-1" data-variant="' +
    esc(variant.id) + '" aria-label="Тоог багасгах">−</button><span>' + quantity + '</span><button type="button" data-change="1" data-variant="' +
    esc(variant.id) + '" aria-label="Тоог нэмэх"' + (quantity >= Math.min(10,variant.stock) ? " disabled" : "") + '>+</button></div></div><strong>' +
    money(quantity * variant.price) + '</strong></div>').join("") +
    '<div class="bag-total"><span>Нийт</span><span>' + money(total) + '</span></div><p class="muted">Хүргэлт үнэгүй</p>' +
    (!canCheckout ? '<p class="error">Зарим барааны тоог багасгана уу.</p>' : '') +
    (checkout ? '<button id="open-checkout" class="primary" type="button"' + (!canCheckout ? " disabled" : "") +
      '>Захиалах</button>' : '<p class="muted">Онлайн төлбөр удахгүй нээгдэнэ.</p>') :
    '<p>Таны сагс хоосон байна.</p><form method="dialog"><button class="primary">Цуглуулга үзэх</button></form>';
  if (previous) {
    const replacement = [...content.querySelectorAll("[data-change]:enabled")].find(button =>
      button.dataset.variant === previous.variant && button.dataset.change === previous.change);
    (replacement ?? content.querySelector("button:enabled") ?? bagDialog.querySelector(".close")).focus();
  }
}
function openBag() {
  updateBag();
  bagDialog.showModal();
}
$("#filters").addEventListener("click", event => {
  const filter = event.target.closest("button[data-category]");
  if (!filter) return;
  for (const button of $("#filters").children) button.setAttribute("aria-pressed", String(button === filter));
  for (const item of rail.children) item.hidden = filter.dataset.category !== "all" && filter.dataset.category !== item.dataset.category;
  rail.scrollLeft = 0;
});
for (const container of [rail,$("#look-content")]) {
  container.addEventListener("click", event => {
    const item = event.target.closest("[data-product]");
    if (item) details(products.find(product => product.id === item.dataset.product));
  });
}
function changeLook(direction) { lookIndex = (lookIndex + direction + looks.length) % looks.length; showLook(); }
$("#previous-look").addEventListener("click", () => changeLook(-1));
$("#next-look").addEventListener("click", () => changeLook(1));
$("#bag-button").addEventListener("click", openBag);
$("#bag-content").addEventListener("click", event => {
  const change = event.target.closest("[data-change]");
  if (change) {
    const { variant, change:delta } = change.dataset;
    const count = (cart.get(variant) ?? 0) + Number(delta);
    if (count <= 0) cart.delete(variant);
    else if (count <= 10) cart.set(variant, count);
    saveCart();
    updateBag(change.dataset);
    return;
  }
  if (event.target.id === "open-checkout") {
    checkoutForm.elements.province.replaceChildren(...regions.map(name => new Option(name,name)));
    $("#checkout-error").textContent = "";
    bagDialog.close();
    checkoutDialog.showModal();
  }
});
checkoutForm.addEventListener("submit", async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(checkoutForm));
  const items = cartRows().map(row => ({ id:row.variant.id, quantity:row.quantity }));
  const signature = JSON.stringify([fields,items]);
  if (!attempt || attempt.signature !== signature) attempt = { id:crypto.randomUUID(), signature };
  const button = checkoutForm.querySelector("button[type=submit]");
  button.disabled = true;
  $("#checkout-error").textContent = "";
  try {
    const data = await api("/api/checkout", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ ...fields, items, id:attempt.id })
    });
    try { sessionStorage.setItem("repbish-order-" + attempt.id, JSON.stringify(items)); } catch {}
    location.assign(data.url);
  } catch (error) {
    $("#checkout-error").textContent = error.message;
    if (error.status === 409 || error.status === 410) attempt = null;
    button.disabled = false;
  }
});
async function orderStatus(id) {
  const area = $("#order-result");
  const button = $("#check-order");
  button.disabled = true;
  try {
    const info = await api("/api/orders/" + encodeURIComponent(id));
    const names = { pending:"Төлбөр хүлээгдэж байна", paid:"Төлбөр баталгаажлаа", shipped:"Хүргэлтэд гарсан", canceled:"Захиалга цуцлагдсан" };
    area.replaceChildren();
    const status = document.createElement("p");
    status.textContent = names[info.status] + " · " + money(info.amount);
    area.append(status);
    if (info.tracking) {
      const tracking = document.createElement("p");
      tracking.textContent = "Хүргэлтийн дугаар " + info.tracking;
      area.append(tracking);
    }
    if (info.payment) {
      const link = document.createElement("a");
      link.href = info.payment;
      link.className = "quiet-link";
      link.textContent = "Wire төлбөр рүү буцах";
      area.append(link);
    }
    if (info.status === "paid" || info.status === "shipped") {
      try {
        const key = "repbish-order-" + id;
        for (const item of JSON.parse(sessionStorage.getItem(key) ?? "[]")) {
          const remaining = (cart.get(item.id) ?? 0) - item.quantity;
          if (remaining > 0) cart.set(item.id, remaining);
          else cart.delete(item.id);
        }
        sessionStorage.removeItem(key);
        saveCart();
      } catch {}
    }
  } catch (error) { area.textContent = error.message; }
  finally { button.disabled = false; }
}
async function initialize() {
  saveCart();
  const order = location.pathname.match(/^\/order\/([^/]+)$/);
  if (order) {
    $("#collection").hidden = true;
    $("#looks").hidden = true;
    $("#bag-button").hidden = true;
    $("#order-status").hidden = false;
    $("#check-order").addEventListener("click", () => orderStatus(order[1]));
    await orderStatus(order[1]);
    return;
  }
  try {
    const data = await api("/api/catalog");
    regions = data.regions;
    checkout = data.checkout;
    products = data.products.length ? data.products : demos;
    looks = data.products.length ? data.looks : [demoLook];
    $("#catalog-note").textContent = data.products.length ? "" : "Дэлгүүрийн танилцуулга · жишээ бараа";
    const ids = new Set(data.products.flatMap(product => product.variants.map(variant => variant.id)));
    for (const id of cart.keys()) if (!ids.has(id)) cart.delete(id);
    saveCart();
    showRail();
    showLook();
  } catch {
    $("#catalog-note").textContent = "Цуглуулгыг ачаалж чадсангүй. Хуудсаа шинэчилнэ үү.";
    $("#looks").hidden = true;
  }
}
initialize();
