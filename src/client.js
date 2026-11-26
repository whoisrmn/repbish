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
  id,title,category,image,brand:"",description:"",
  demo:true,variants:[{ id, price, color, size:"M", stock:0 }]
}));
// Placeholder people for the sample looks: flat illustrated figures (viewBox 200×520) wearing the sample pieces.
// Real looks use a full-body photo with a transparent background uploaded in the admin.
const tones = { hoodie:"#5a3a48", tee:"#e6e0d3", trousers:"#3f4042", denim:"#6f86a2", "light-denim":"#a3b3c4" };
function figure({ skin, hair, top, pants, cap }) {
  const color = tones[top];
  const sleeveL = top === "tee" ? "M62 98 L44 112 L39 152 L57 154 L60 122 Z" : "M62 98 L44 112 L34 230 L50 232 L58 140 Z";
  const sleeveR = top === "tee" ? "M138 98 L156 112 L161 152 L143 154 L140 122 Z" : "M138 98 L156 112 L166 230 L150 232 L142 140 Z";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 520">' +
    '<path d="M58 244 L142 244 L152 472 L108 472 L100 300 L92 472 L48 472 Z" fill="' + tones[pants] + '"/>' +
    '<path d="M100 300 L100 470" stroke="#000" stroke-opacity=".12"/>' +
    '<ellipse cx="72" cy="478" rx="27" ry="9" fill="#f2f2f0" stroke="#cfcfcf"/><ellipse cx="128" cy="478" rx="27" ry="9" fill="#f2f2f0" stroke="#cfcfcf"/>' +
    '<path d="M62 98 L44 112 L34 230 L50 232 L58 140 Z M138 98 L156 112 L166 230 L150 232 L142 140 Z" fill="' + skin + '"/>' +
    '<circle cx="42" cy="240" r="9" fill="' + skin + '"/><circle cx="158" cy="240" r="9" fill="' + skin + '"/>' +
    '<path d="' + sleeveL + '" fill="' + color + '"/><path d="' + sleeveR + '" fill="' + color + '"/>' +
    '<rect x="91" y="72" width="18" height="22" fill="' + skin + '"/>' +
    '<path d="M62 98 Q100 86 138 98 L150 122 L146 254 L54 254 L50 122 Z" fill="' + color + '"/>' +
    '<path d="M62 98 L58 140 M138 98 L142 140" stroke="#000" stroke-opacity=".1"/>' +
    (top === "hoodie" ? '<path d="M72 96 Q100 72 128 96 Q100 112 72 96 Z" fill="#000" fill-opacity=".18"/><path d="M72 190 L128 190 L122 228 L78 228 Z" fill="#000" fill-opacity=".08"/>' :
      '<path d="M86 92 Q100 104 114 92" stroke="#000" stroke-opacity=".15" fill="none"/>') +
    '<circle cx="100" cy="54" r="23" fill="' + skin + '"/>' +
    (cap ? '<path d="M76 50 Q77 24 100 25 Q124 24 124 50 Z" fill="#3a3a3a"/><path d="M100 46 L140 49 Q141 53 100 53 Z" fill="#2c2c2c"/>' :
      '<path d="M77 54 Q76 25 100 26 Q125 25 123 54 Q118 37 100 37 Q83 37 77 54 Z" fill="' + hair + '"/>') +
    '</svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
const pin = { hoodie:[50,30], tee:[50,28], trousers:[38,70], cap:[51,6] };
const demoLooks = [
  ["Өдөр тутам", { skin:"#c99a78", hair:"#2a1d16", top:"hoodie", pants:"trousers", cap:true }, ["hoodie","trousers","cap"]],
  ["Хотын алхалт", { skin:"#8d5a3b", hair:"#141414", top:"tee", pants:"trousers" }, ["tee","trousers"]],
  ["Амралтын өдөр", { skin:"#e2b896", hair:"#4a3020", top:"hoodie", pants:"denim" }, ["hoodie"]],
  ["Энгийн", { skin:"#b07a55", hair:"#111", top:"tee", pants:"light-denim", cap:true }, ["tee","cap"]],
  ["Орой", { skin:"#d6a684", hair:"#2b2b2b", top:"hoodie", pants:"trousers" }, ["hoodie","trousers"]]
].map(([title, look, items]) => ({
  title, demo:true, src:figure(look), pins:items.map(product => ({ product, x:pin[product][0], y:pin[product][1] }))
}));
function loadCart() {
  try {
    const data = JSON.parse(localStorage.getItem("repbish-cart-v1") ?? "[]");
    return new Map(data.filter(item => Array.isArray(item) && typeof item[0] === "string" && Number.isInteger(item[1]) && item[1] > 0 && item[1] <= 10));
  } catch { return new Map(); }
}
const cart = loadCart();
const priceOf = product => Math.min(...product.variants.map(variant => variant.price));
// sample looks can point at sample pieces even after real products exist
const findProduct = id => products.find(item => item.id === id) ?? demos.find(item => item.id === id);
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
// On the rack a garment hangs side-on; hovering turns it to face front.
// With a front photo, the main photo is the side shot and the front photo swaps in on hover.
// Without one ("turn" class), the main photo is turned side-on in 3D and rotates flat on hover.
function garment(product, index, labelled = false) {
  const src = esc(media(product.image, product.demo));
  const qty = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
  const available = product.demo || qty;
  const tag = available ? money(priceOf(product)) : "Дууссан";
  return '<button type="button" class="garment' + (product.front_image ? '' : ' turn') + '" data-product="' + esc(product.id) +
    '" data-category="' + esc(product.category) + '" aria-label="' + esc(product.title + " · " + tag) +
    '"><span class="garment-photo"><img class="garment-regular" alt="" decoding="async"' + (index >= 8 ? ' loading="lazy"' : '') + ' src="' + src +
    '"><span class="tag' + (available ? '' : ' sold') + '">' + tag + '</span></span>' +
    (labelled ? '<span class="garment-label">' + esc(product.title) + '</span><span class="garment-brand">' + esc(product.brand) + '</span>' : '') + '</button>';
}
function showRail() {
  if (products.length >= 5) {
    rail.style.setProperty("--rail-columns", 5);
    rail.style.setProperty("--rail-gap", "48px");
  }
  const categories = Object.entries(labels).filter(([key]) => key === "all" || products.some(product => product.category === key));
  $("#filters").innerHTML = categories.map(([key, label]) =>
    '<button type="button" data-category="' + key + '" aria-pressed="' + (key === "all") + '">' + label + '</button>').join("");
  // with only the few sample pieces, repeat them so the sample rack looks full
  const hanging = products.every(product => product.demo) ? [...products, ...products, ...products] : products;
  rail.innerHTML = hanging.map((product, index) => garment(product, index)).join("");
  bindFronts(rail);
  hangAll(rail);
}
// ---------- hanging photos on the rod ----------
// Product photos often have empty space above the hook, which would leave the garment floating under the rod.
// We find the first row of the photo that has something in it (the hook) and lift the image so that row meets the rod.
const hookTops = new Map();
function hookTop(img) {
  if (hookTops.has(img.src)) return hookTops.get(img.src);
  let top = 0;
  try {
    const width = 120, height = Math.max(1, Math.round(120 * img.naturalHeight / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently:true });
    context.drawImage(img, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    // only the middle of the photo, where the hook is, so edge noise doesn't count
    find: for (let y = 0; y < height * .5; y++) {
      for (let x = Math.round(width * .2); x < width * .8; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 40 && Math.min(data[i], data[i + 1], data[i + 2]) < 215) { top = y / height; break find; }
      }
    }
  } catch { /* unreadable image: leave it where it is */ }
  hookTops.set(img.src, top);
  return top;
}
const rodGrip = 6; // px of the photo box above the rod's centre: the hook curls over the rod here
function hang(img) {
  if (!img.naturalWidth || !img.clientHeight) return;
  const scale = Math.min(img.clientWidth / img.naturalWidth, img.clientHeight / img.naturalHeight);
  img.style.setProperty("--lift", Math.max(0, hookTop(img) * img.naturalHeight * scale - rodGrip) + "px");
}
function hangAll(container) {
  for (const img of container.querySelectorAll(".garment-photo img")) {
    if (img.complete) hang(img);
    else img.addEventListener("load", () => hang(img), { once:true });
  }
}
// photo boxes change size with the window, so re-hang after resizes
let hangTimer;
new ResizeObserver(() => { clearTimeout(hangTimer); hangTimer = setTimeout(() => hangAll(rail), 120); }).observe(rail);

// loads the optional front-facing photo the first time a hanger is hovered or focused
function bindFronts(container) {
  for (const card of container.children) {
    const product = products.find(item => item.id === card.dataset.product);
    if (!product.front_image) continue;
    const loadFront = () => {
      const photo = card.querySelector(".garment-photo");
      if (photo.querySelector(".garment-front")) return;
      const img = document.createElement("img");
      img.className = "garment-front";
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("load", () => { hang(img); photo.classList.add("front-ready"); }, { once:true });
      img.src = media(product.front_image);
      photo.prepend(img);
    };
    card.addEventListener("pointerenter", loadFront, { once:true });
    card.addEventListener("focus", loadFront, { once:true });
  }
}
const stage = $("#look-stage");
const steps = $("#look-steps");
const panel = $("#look-panel");
let lookPaused = matchMedia("(prefers-reduced-motion: reduce)").matches;
function lookPieces(look) {
  const pins = look.pins.map(pin => ({ ...pin, item:findProduct(pin.product) })).filter(pin => pin.item);
  return { pins, pieces:[...new Set(pins.map(pin => pin.item))] };
}
// Builds every figure once; showLook() only moves them.
function renderLooks() {
  if (!looks.length) {
    stage.innerHTML = '<p class="look-empty">Шинэ хослол удахгүй нэмэгдэнэ.</p>';
    panel.hidden = true;
    return;
  }
  stage.innerHTML = looks.map((look, index) => {
    const dots = lookPieces(look).pins.map(({ x,y,item }, number) =>
      '<button type="button" class="hotspot" style="left:' + x + '%;top:' + y + '%" data-product="' + esc(item.id) +
      '" aria-label="' + esc(item.title) + '">' + (number + 1) + '</button>').join("");
    return '<div class="look-figure' + (look.demo ? "" : " photo") + '" data-look="' + index + '" role="group" aria-roledescription="slide" aria-label="' + esc(look.title) +
      '"><img alt="' + esc(look.title) + '" decoding="async" draggable="false"' + (index > 2 ? ' loading="lazy"' : '') +
      ' src="' + esc(look.src ?? media(look.image)) + '">' + dots + '</div>';
  }).join("");
  steps.innerHTML = looks.map((look, index) =>
    '<button type="button" class="look-step" data-step="' + index + '" aria-label="' + esc(look.title) + '"><span class="look-step-bar"><span></span></span>' +
    '<span class="look-step-label"><span>' + String(index + 1).padStart(2, "0") + '</span><span class="look-step-title">' + esc(look.title) + '</span></span></button>').join("");
  $("#look-controls").hidden = looks.length < 2;
  setPaused(lookPaused);
  showLook();
}
function showLook() {
  if (!looks.length) return;
  const count = looks.length;
  for (const figure of stage.children) {
    let offset = Number(figure.dataset.look) - lookIndex;
    if (count > 2) offset = ((offset % count) + count + Math.floor(count / 2)) % count - Math.floor(count / 2);
    const distance = Math.abs(offset);
    figure.style.setProperty("--o", offset);
    figure.style.setProperty("--a", Math.min(distance, 4));
    figure.classList.toggle("active", offset === 0);
    figure.classList.toggle("far", distance > 3);
    figure.setAttribute("aria-hidden", String(offset !== 0));
    for (const dot of figure.querySelectorAll(".hotspot")) dot.tabIndex = offset === 0 ? 0 : -1;
  }
  for (const step of steps.children) {
    const active = Number(step.dataset.step) === lookIndex;
    step.classList.remove("active");
    if (active) { void step.offsetWidth; step.classList.add("active"); }
    step.toggleAttribute("aria-current", active);
  }
  showLookPanel(looks[lookIndex]);
}
function showLookPanel(look) {
  const { pins, pieces } = lookPieces(look);
  panel.hidden = false;
  const rows = pieces.map(item => {
    const options = item.variants.map(variant =>
      '<option value="' + esc(variant.id) + '"' + (!variant.stock && !item.demo ? " disabled" : "") + '>' + esc(variant.size) + ' / ' + esc(variant.color) +
      (!variant.stock && !item.demo ? " · Дууссан" : "") + '</option>').join("");
    return '<div class="look-row"><span class="look-num">' + (pins.findIndex(pin => pin.item === item) + 1) + '</span>' +
      '<button type="button" class="look-thumb" data-product="' + esc(item.id) + '" aria-label="' + esc(item.title) + '"><img alt="" loading="lazy" decoding="async" src="' +
      esc(media(item.image, item.demo)) + '"></button><div class="look-text">' + (item.brand ? '<small>' + esc(item.brand) + '</small>' : '') +
      '<button type="button" class="look-name" data-product="' + esc(item.id) + '">' + esc(item.title) + '</button><span class="look-price"></span>' +
      '<select class="look-size" data-item="' + esc(item.id) + '" aria-label="Хэмжээ, өнгө: ' + esc(item.title) + '">' + options + '</select></div>' +
      '<button type="button" class="look-plus" data-product="' + esc(item.id) + '" aria-label="Дэлгэрэнгүй: ' + esc(item.title) + '">+</button></div>';
  }).join("");
  const buyable = pieces.length && pieces.every(item => !item.demo && item.variants.some(variant => variant.stock));
  panel.innerHTML = '<div class="panel-head"><h3>Энэ хослолд</h3><span>' + pieces.length + ' ширхэг</span></div>' + rows +
    '<div class="panel-foot"><div class="panel-total"><span>Бүтэн хослол</span><strong id="look-total"></strong></div>' +
    '<button type="button" class="primary" id="add-look"' + (buyable ? '' : ' disabled') + '>Бүтэн хослолыг сагслах →</button></div>';
  updateLookTotal();
}
function lookSelection() {
  return [...panel.querySelectorAll(".look-size")].map(select => {
    const product = findProduct(select.dataset.item);
    return { product, select, variant:product.variants.find(variant => variant.id === select.value) };
  });
}
function updateLookTotal() {
  let total = 0;
  for (const { select, variant } of lookSelection()) {
    total += variant?.price ?? 0;
    select.closest(".look-text").querySelector(".look-price").textContent = money(variant?.price ?? 0);
  }
  const node = $("#look-total");
  if (node) node.textContent = money(total);
}
function setPaused(paused) {
  lookPaused = paused;
  steps.classList.toggle("paused", paused);
  const button = $("#pause-look");
  button.setAttribute("aria-pressed", String(paused));
  button.textContent = paused ? "▶" : "❚❚";
  button.setAttribute("aria-label", paused ? "Тоглуулах" : "Зогсоох");
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
    (!purchasable && !product.demo ? " disabled" : "") + '>' + options + '</select></label>' +
    (chartOf(product) ? '<button type="button" class="pp-guide" id="detail-guide" aria-haspopup="dialog">Хэмжээний заавар</button>' : '') + '<strong id="variant-price" class="detail-price"></strong>' +
    (product.demo ? '' : '<button class="primary" type="submit"' +
      (!purchasable ? ' disabled>Дууссан' : '>Сагсанд нэмэх') + '</button>') + '</form><a class="quiet-link detail-more" href="/products/' +
    encodeURIComponent(product.id) + '">Дэлгэрэнгүй үзэх →</a></div></div>';
  const form = $("#product-options");
  const select = form.elements.variant;
  const showPrice = () => {
    const item = product.variants.find(variant => variant.id === select.value);
    $("#variant-price").textContent = money(item?.price ?? priceOf(product));
  };
  showPrice();
  select.addEventListener("change", showPrice);
  $("#detail-guide")?.addEventListener("click", () => showSizeGuide(product, product.variants.find(variant => variant.id === select.value)?.size));
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
// ---------- shop page (/products) ----------
// Every product in a grid. Filter and sort live in the address (?category=tops&sort=price-asc) so the view can be shared.
const sorts = { featured:"Санал болгох", "price-asc":"Үнэ: багаас их", "price-desc":"Үнэ: ихээс бага" };
function shopCard(product) {
  const stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
  const main = media(product.front_image || product.image, product.demo);
  const other = product.front_image && product.image ? media(product.image, product.demo) : "";
  return '<li><a class="shop-card" href="/products/' + encodeURIComponent(product.id) + '"><span class="shop-photo">' +
    '<img alt="" loading="lazy" decoding="async" src="' + esc(main) + '">' +
    (other ? '<img class="shop-alt" alt="" loading="lazy" decoding="async" src="' + esc(other) + '">' : '') +
    (product.demo || stock ? '' : '<span class="shop-sold">Дууссан</span>') + '</span>' +
    (product.brand ? '<span class="shop-brand">' + esc(product.brand) + '</span>' : '') +
    '<span class="shop-name">' + esc(product.title) + '</span><span class="shop-price">' + money(priceOf(product)) + '</span></a></li>';
}
function showShopPage() {
  const page = $("#shop-page");
  $("#collection").hidden = true;
  $("#looks").hidden = true;
  page.hidden = false;
  const params = new URLSearchParams(location.search);
  const present = Object.entries(labels).filter(([key]) => key === "all" || products.some(product => product.category === key));
  let category = present.some(([key]) => key === params.get("category")) ? params.get("category") : "all";
  let sort = Object.hasOwn(sorts, params.get("sort")) ? params.get("sort") : "featured";
  page.innerHTML = '<div class="shop-head"><h1 id="shop-title">Бүх бараа</h1><p id="shop-count" class="shop-count" aria-live="polite"></p></div>' +
    '<div class="shop-controls"><div class="filters shop-filters" id="shop-filters" aria-label="Ангилал">' + present.map(([key, label]) =>
      '<button type="button" data-category="' + key + '">' + label + '</button>').join("") + '</div>' +
    '<label class="shop-sort">Эрэмбэ<select id="shop-sort">' + Object.entries(sorts).map(([key, label]) =>
      '<option value="' + key + '">' + label + '</option>').join("") + '</select></label></div><ul class="shop-grid" id="shop-grid"></ul>';
  const render = () => {
    for (const button of page.querySelectorAll("[data-category]")) button.setAttribute("aria-pressed", String(button.dataset.category === category));
    $("#shop-sort").value = sort;
    const list = products.filter(product => category === "all" || product.category === category);
    if (sort !== "featured") list.sort((left, right) => (priceOf(left) - priceOf(right)) * (sort === "price-asc" ? 1 : -1));
    $("#shop-count").textContent = list.length + " бараа";
    $("#shop-grid").innerHTML = list.length ? list.map(shopCard).join("") : '<li class="shop-empty">Энэ ангилалд одоогоор бараа алга.</li>';
    const query = new URLSearchParams();
    if (category !== "all") query.set("category", category);
    if (sort !== "featured") query.set("sort", sort);
    history.replaceState(null, "", "/products" + (query.size ? "?" + query : ""));
    document.title = (category === "all" ? "Бүх бараа" : labels[category]) + " | Repbish";
  };
  page.querySelector("#shop-filters").addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (button) { category = button.dataset.category; render(); }
  });
  $("#shop-sort").addEventListener("change", event => { sort = event.target.value; render(); });
  render();
}

// ---------- size guide ----------
const chartOf = product => { try { return product.size_chart ? JSON.parse(product.size_chart) : null; } catch { return null; } };
const measureTips = {
  "Цээж":"Сугын доор, нэг талаас нөгөө тал хүртэл хавтгайгаар.", "Урт":"Мөрний хамгийн дээд цэгээс доод захын ирмэг хүртэл.",
  "Мөр":"Нэг мөрний оёдлоос нөгөө мөрний оёдол хүртэл.", "Ханцуй":"Мөрний оёдлоос ханцуйн үзүүр хүртэл.",
  "Бүсэлхий":"Бүсний дээд ирмэгийг нэг талаас нөгөө тал хүртэл хавтгайгаар.", "Ташаа":"Өмдний хамгийн өргөн хэсгийг хавтгайгаар.",
  "Гадна урт":"Бүсний дээд ирмэгээс шуумаг хүртэл гадна талаар.", "Дотор урт":"Алхамын оёдлоос шуумаг хүртэл дотор талаар.",
  "Тойрог":"Малгайн дотор талын тойргийг бүтнээр."
};
function showSizeGuide(product, selected) {
  const chart = chartOf(product);
  if (!chart) return;
  const tips = chart.columns.filter(column => measureTips[column]);
  $("#size-content").innerHTML = '<p class="size-product">' + esc([product.brand, product.title].filter(Boolean).join(" · ")) + '</p>' +
    (product.fit_note ? '<p class="size-fit">' + esc(product.fit_note) + '</p>' : '') +
    '<div class="size-scroll"><table class="size-table"><caption class="sr-only">Хэмжээ, сантиметрээр</caption><thead><tr><th scope="col">Хэмжээ</th>' +
    chart.columns.map(column => '<th scope="col">' + esc(column) + '</th>').join("") + '</tr></thead><tbody>' +
    chart.rows.map(row => '<tr' + (row.size === selected ? ' class="selected" aria-current="true"' : '') + '><th scope="row">' + esc(row.size) + '</th>' +
      row.values.map(cell => '<td>' + (cell ?? "—") + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>' +
    '<p class="size-unit">Бүх хэмжээ сантиметрээр, хувцсыг хавтгай тавьж хэмжсэн. Цээж, бүсэлхийн тойргийг мэдэхийн тулд 2-оор үржүүлнэ. 1–2 см зөрүү байж болно.</p>' +
    (tips.length ? '<h3>Хэрхэн хэмжих вэ</h3><dl class="size-tips">' + tips.map(column => '<dt>' + esc(column) + '</dt><dd>' + measureTips[column] + '</dd>').join("") + '</dl>' : '') +
    '<p class="size-help">Аль хэмжээ таарахыг мэдэхгүй байвал <a href="/info/contact">бидэнтэй холбогдоорой</a>.</p>';
  $("#size-dialog").showModal();
}

// ---------- product page (/products/:id) ----------
function addToCart(product, variant) {
  if (!variant?.stock || product.demo) return;
  const count = cart.get(variant.id) ?? 0;
  if (count < Math.min(variant.stock, 10)) cart.set(variant.id, count + 1);
  saveCart();
  openBag();
  $("#announcement").textContent = product.title + " сагсанд нэмэгдлээ.";
}
function showProductPage(id) {
  const page = $("#product-page");
  $("#collection").hidden = true;
  $("#looks").hidden = true;
  page.hidden = false;
  const product = products.find(item => item.id === id);
  if (!product) {
    document.title = "Бараа олдсонгүй | Repbish";
    page.innerHTML = '<div class="pp-missing"><h1>Бараа олдсонгүй</h1><p class="muted">Энэ бараа дууссан эсвэл дэлгүүрээс хасагдсан байж магадгүй.</p>' +
      '<a class="quiet-link" href="/">Дэлгүүр рүү буцах</a></div>';
    return;
  }
  document.title = product.title + (product.brand ? " — " + product.brand : "") + " | Repbish";
  const buyable = variant => product.demo || variant.stock > 0;
  const shots = [product.front_image && { src:media(product.front_image), label:"Урд тал" },
    product.image && { src:media(product.image, product.demo), label:"Өлгүүр дээр" }].filter(Boolean);
  const colors = [...new Set(product.variants.map(variant => variant.color))];
  const inLooks = looks.map((look, index) => ({ look, index })).filter(({ look }) => look.pins.some(pin => pin.product === product.id));
  page.innerHTML = '<nav class="pp-crumbs" aria-label="Зам"><a href="/">Дэлгүүр</a><span aria-hidden="true">/</span><a href="/products?category=' + encodeURIComponent(product.category) + '">' +
    esc(labels[product.category] ?? "Бүх бараа") + '</a></nav><div class="pp-layout"><div class="pp-gallery"><div class="pp-main"><img id="pp-image" alt="' +
    esc(product.title) + '" src="' + esc(shots[0]?.src ?? "") + '"></div>' +
    (shots.length > 1 ? '<div class="pp-thumbs">' + shots.map((shot, index) => '<button type="button" data-shot="' + index + '" aria-label="' + shot.label +
      '" aria-pressed="' + (index === 0) + '"><img alt="" src="' + esc(shot.src) + '"></button>').join("") + '</div>' : '') +
    '</div><div class="pp-info">' + (product.brand ? '<p class="overline">' + esc(product.brand) + '</p>' : '') +
    '<h1>' + esc(product.title) + '</h1><p class="pp-price" id="pp-price"></p>' +
    '<div class="pp-option"><p class="pp-label">Өнгө: <span id="pp-color-name"></span></p>' + (colors.length > 1 ? '<div class="pp-chips" id="pp-colors">' +
      colors.map(color => '<button type="button" data-color="' + esc(color) + '">' + esc(color) + '</button>').join("") + '</div>' : '') + '</div>' +
    '<div class="pp-option"><div class="pp-label-row"><p class="pp-label">Хэмжээ</p>' + (chartOf(product) ? '<button type="button" class="pp-guide" id="pp-guide" aria-haspopup="dialog">Хэмжээний заавар</button>' : '') +
    '</div><div class="pp-chips" id="pp-sizes"></div></div><p id="pp-stock" class="pp-stock" aria-live="polite"></p>' +
    '<div class="pp-actions">' + (product.demo ? '' : '<button type="button" class="primary" id="pp-add">Сагсанд нэмэх</button>') +
    '<button type="button" class="secondary pp-share" id="pp-share">Холбоос хуваалцах</button></div>' +
    '<ul class="pp-notes"><li>Монгол даяар үнэгүй хүргэлт</li><li>Оригинал брэнд</li></ul>' +
    (product.description ? '<div class="pp-section"><h2>Тайлбар</h2><p>' + esc(product.description) + '</p></div>' : '') +
    (inLooks.length ? '<div class="pp-section"><h2>Энэ хослолд багтсан</h2><div class="pp-looks">' + inLooks.map(({ look, index }) =>
      '<a href="/#look-' + index + '"><img alt="" loading="lazy" src="' + esc(look.src ?? media(look.image)) + '"><span>' + esc(look.title) + '</span></a>').join("") +
      '</div></div>' : '') + '</div></div>';
  let color = colors.find(name => product.variants.some(variant => variant.color === name && buyable(variant))) ?? colors[0];
  let chosen = null;
  const render = () => {
    const sizes = product.variants.filter(variant => variant.color === color);
    if (!chosen || chosen.color !== color) chosen = sizes.find(buyable) ?? null;
    $("#pp-color-name").textContent = color;
    for (const button of page.querySelectorAll("[data-color]")) button.setAttribute("aria-pressed", String(button.dataset.color === color));
    $("#pp-sizes").innerHTML = sizes.map(variant => '<button type="button" data-variant="' + esc(variant.id) + '" aria-pressed="' + (variant === chosen) + '"' +
      (buyable(variant) ? '' : ' disabled') + '>' + esc(variant.size) + '</button>').join("");
    $("#pp-price").textContent = money(chosen?.price ?? Math.min(...sizes.map(variant => variant.price)));
    $("#pp-stock").textContent = product.demo ? "" : !chosen ? "Энэ өнгө дууссан" :
      chosen.stock <= 3 ? "Зөвхөн " + chosen.stock + " ширхэг үлдсэн" : "Бэлэн байгаа";
    const add = $("#pp-add");
    if (add) { add.disabled = !chosen?.stock; add.textContent = chosen?.stock ? "Сагсанд нэмэх" : "Дууссан"; }
  };
  render();
  page.onclick = async event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.color) { color = target.dataset.color; chosen = null; render(); }
    else if (target.dataset.variant) { chosen = product.variants.find(variant => variant.id === target.dataset.variant); render(); }
    else if (target.dataset.shot) {
      $("#pp-image").src = shots[Number(target.dataset.shot)].src;
      for (const button of page.querySelectorAll("[data-shot]")) button.setAttribute("aria-pressed", String(button === target));
    }
    else if (target.id === "pp-add") addToCart(product, chosen);
    else if (target.id === "pp-guide") showSizeGuide(product, chosen?.size);
    else if (target.id === "pp-share") {
      const link = location.origin + "/products/" + encodeURIComponent(product.id);
      try {
        if (navigator.share) await navigator.share({ title:product.title, url:link });
        else { await navigator.clipboard.writeText(link); target.textContent = "Холбоос хуулагдлаа"; }
      } catch { /* the viewer closed the share sheet */ }
    }
  };
  const others = products.filter(item => item.id !== product.id)
    .sort((left, right) => Number(right.category === product.category) - Number(left.category === product.category)).slice(0, 10);
  if (others.length) {
    $("#related").hidden = false;
    $("#related-rail").innerHTML = others.map((item, index) => garment(item, index, true)).join("");
    bindFronts($("#related-rail"));
  }
}
$("#related-rail").addEventListener("click", event => {
  const item = event.target.closest("[data-product]");
  if (item) location.assign("/products/" + encodeURIComponent(item.dataset.product));
});
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
function applyFilter(category) {
  if (![...$("#filters").children].some(button => button.dataset.category === category)) category = "all";
  for (const button of $("#filters").children) button.setAttribute("aria-pressed", String(button.dataset.category === category));
  for (const item of rail.children) item.hidden = category !== "all" && category !== item.dataset.category;
  rail.scrollLeft = 0;
}
$("#filters").addEventListener("click", event => {
  const filter = event.target.closest("button[data-category]");
  if (filter) applyFilter(filter.dataset.category);
});
// "/#category-tops" opens the rack filtered to that category (used by the menu)
function followCategoryHash() {
  const match = location.hash.match(/^#category-([a-z]+)$/);
  if (!match || $("#collection").hidden) return;
  applyFilter(match[1]);
  $("#collection").scrollIntoView();
}
addEventListener("hashchange", followCategoryHash);

// thin rule under the header once the page has scrolled
const header = document.querySelector(".site-header");
addEventListener("scroll", () => header.classList.toggle("scrolled", scrollY > 8), { passive:true });

// ---------- mobile menu ----------
const menuDialog = $("#menu-dialog");
$("#menu-button").addEventListener("click", () => {
  menuDialog.showModal();
  $("#menu-button").setAttribute("aria-expanded", "true");
});
menuDialog.addEventListener("close", () => $("#menu-button").setAttribute("aria-expanded", "false"));
// links to a spot on this same page don't reload it, so close the menu ourselves
menuDialog.addEventListener("click", event => {
  if (event.target.closest("a")) menuDialog.close();
  else if (event.target === menuDialog) menuDialog.close();
});
function showMenuCategories() {
  const present = Object.entries(labels).filter(([key]) => key !== "all" && products.some(product => product.category === key));
  $("#menu-shop").innerHTML = '<li><a href="/products">Бүх бараа</a></li>' +
    present.map(([key, label]) => '<li><a href="/products?category=' + key + '">' + label + '</a></li>').join("");
}
let dragged = false;
for (const container of [rail, stage, panel]) {
  container.addEventListener("click", event => {
    if (dragged) return;
    const item = event.target.closest("[data-product]");
    if (item) { details(findProduct(item.dataset.product)); return; }
    const figure = event.target.closest(".look-figure:not(.active)");
    if (figure) { lookIndex = Number(figure.dataset.look); showLook(); }
  });
}
function changeLook(direction) { lookIndex = (lookIndex + direction + looks.length) % looks.length; showLook(); }
$("#previous-look").addEventListener("click", () => changeLook(-1));
$("#next-look").addEventListener("click", () => changeLook(1));
$("#pause-look").addEventListener("click", () => setPaused(!lookPaused));
steps.addEventListener("click", event => {
  const step = event.target.closest("[data-step]");
  if (step) { lookIndex = Number(step.dataset.step); showLook(); }
});
// the active step's bar fills over a few seconds, then the next look comes in
steps.addEventListener("animationend", event => { if (event.target.closest(".look-step.active")) changeLook(1); });
let dragStart = null;
stage.addEventListener("pointerdown", event => { dragStart = event.clientX; dragged = false; });
stage.addEventListener("pointermove", event => { if (dragStart !== null && Math.abs(event.clientX - dragStart) > 8) dragged = true; });
addEventListener("pointerup", event => {
  if (dragStart === null) return;
  const distance = event.clientX - dragStart;
  dragStart = null;
  if (Math.abs(distance) > 50 && looks.length > 1) changeLook(distance < 0 ? 1 : -1);
  setTimeout(() => { dragged = false; });
});
stage.addEventListener("keydown", event => {
  if (event.key === "ArrowLeft") changeLook(-1);
  if (event.key === "ArrowRight") changeLook(1);
});
panel.addEventListener("change", event => { if (event.target.matches(".look-size")) updateLookTotal(); });
panel.addEventListener("click", event => {
  if (event.target.id !== "add-look") return;
  for (const { product, variant } of lookSelection()) {
    if (!variant?.stock || product.demo) continue;
    const count = cart.get(variant.id) ?? 0;
    if (count < Math.min(variant.stock, 10)) cart.set(variant.id, count + 1);
  }
  saveCart();
  openBag();
  $("#announcement").textContent = "Хослол сагсанд нэмэгдлээ.";
});
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
// ---------- store information pages (/info/:slug) ----------
// First drafts. Highlighted [brackets] are details only the store owner can confirm.
const fill = text => '<mark class="fill">[' + text + ']</mark>';
const infoPages = {
  delivery:{ title:"Хүргэлт", body:
    '<p class="info-lead">Монгол даяар хүргэлт <strong>үнэгүй</strong>.</p>' +
    '<h2>Хэдэн өдөрт хүргэх вэ</h2><ul><li>Улаанбаатар: ' + fill("1–2") + ' ажлын өдөр</li><li>Орон нутаг: ' + fill("3–7") +
    ' ажлын өдөр, ' + fill("унаа / шуудан") + '-аар</li></ul>' +
    '<h2>Хэрхэн явагдах вэ</h2><ol><li>Төлбөр Wire-ээр баталгаажсаны дараа захиалга бэлтгэгдэнэ.</li>' +
    '<li>Илгээхээс өмнө бид таны утсаар холбогдож хаягаа баталгаажуулна.</li>' +
    '<li>Хүргэлтийн дугаар гарвал захиалгын хуудсанд харагдана.</li></ol>' +
    '<h2>Асуулт байвал</h2><p><a href="/info/contact">Холбоо барих</a> хуудсанд байгаа утсаар захиалгын дугаараа хэлж холбогдоорой.</p>' },
  returns:{ title:"Буцаалт, солилт", body:
    '<p class="info-lead">Хэмжээ таараагүй эсвэл сэтгэлд нийцээгүй бол хүлээн авснаас хойш ' + fill("7") + ' хоногийн дотор буцааж эсвэл сольж болно.</p>' +
    '<h2>Нөхцөл</h2><ul><li>Өмсөөгүй, угаагаагүй, шошго нь бүтэн байх</li><li>Анхны савлагаатай байх</li>' +
    '<li>Буцаах боломжгүй: ' + fill("дотуур хувцас, хямдралтай бараа") + '</li></ul>' +
    '<h2>Хэмжээ солих</h2><p>Өөр хэмжээ үлдэгдэлтэй бол ' + fill("үнэгүй") + ' сольж өгнө.</p>' +
    '<h2>Мөнгө буцаалт</h2><p>Буцаасан барааг шалгасны дараа ' + fill("5") + ' ажлын өдрийн дотор төлсөн аргаар тань буцаана.</p>' +
    '<h2>Яаж эхлэх вэ</h2><p><a href="/info/contact">Холбоо барих</a> хуудсаар холбогдож захиалгын дугаар, буцаах шалтгаанаа хэлээрэй.</p>' },
  privacy:{ title:"Нууцлал", body:
    '<p class="info-lead">Repbish таны мэдээллийг зөвхөн захиалгыг тань хүргэхэд ашиглана.</p>' +
    '<h2>Бид юу цуглуулдаг вэ</h2><ul><li>Нэр, утасны дугаар, хүргэлтийн хаяг — захиалга хүргэх, тантай холбогдоход</li>' +
    '<li>Захиалсан бараа, дүн, төлбөрийн төлөв</li></ul>' +
    '<h2>Төлбөр</h2><p>Төлбөрийг Wire.mn-ийн хуудсаар хийнэ. Таны картын мэдээллийг Repbish хардаггүй, хадгалдаггүй.</p>' +
    '<h2>Сагс</h2><p>Сагсанд хийсэн бараа зөвхөн таны хөтөч дээр хадгалагдана.</p>' +
    '<h2>Хэнтэй хуваалцдаг вэ</h2><p>Таны мэдээллийг худалдахгүй. Хүргэлт хийх ' + fill("хүргэлтийн компани") + '-д зөвхөн нэр, утас, хаягийг өгнө.</p>' +
    '<h2>Таны эрх</h2><p>Мэдээллээ харах, засах, устгуулахыг хүсвэл <a href="/info/contact">бидэнтэй холбогдоорой</a>.</p>' },
  contact:{ title:"Холбоо барих", body:
    '<p class="info-lead">Захиалга, хэмжээ, хүргэлтийн талаар асуух зүйл байвал бидэнтэй холбогдоорой.</p>' +
    '<dl class="info-contacts"><dt>Утас</dt><dd>' + fill("9911-0000") + '</dd><dt>И-мэйл</dt><dd>' + fill("hello@repbish.com") + '</dd>' +
    '<dt>Instagram</dt><dd>' + fill("@repbish") + '</dd><dt>Facebook</dt><dd>' + fill("Repbish") + '</dd>' +
    '<dt>Цагийн хуваарь</dt><dd>' + fill("Даваа–Баасан 10:00–19:00") + '</dd><dt>Хаяг</dt><dd>' + fill("шоурум байгаа бол хаяг") + '</dd></dl>' }
};
function showInfoPage(slug) {
  const info = infoPages[slug];
  $("#collection").hidden = true;
  $("#looks").hidden = true;
  const page = $("#info-page");
  page.hidden = false;
  page.innerHTML = '<nav class="info-nav" aria-label="Дэлгүүрийн мэдээлэл">' + Object.entries(infoPages).map(([key, item]) =>
    '<a href="/info/' + key + '"' + (key === slug ? ' aria-current="page"' : '') + '>' + item.title + '</a>').join("") +
    '</nav><article class="info-body"><h1>' + info.title + '</h1>' + info.body + '</article>';
}
async function initialize() {
  saveCart();
  const infoRoute = location.pathname.match(/^\/info\/([a-z]+)$/);
  if (infoRoute && Object.hasOwn(infoPages, infoRoute[1])) showInfoPage(infoRoute[1]);
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
    looks = data.looks.length ? data.looks : demoLooks;
    $("#catalog-note").textContent = "";
    const ids = new Set(data.products.flatMap(product => product.variants.map(variant => variant.id)));
    for (const id of cart.keys()) if (!ids.has(id)) cart.delete(id);
    saveCart();
    showMenuCategories();
    if (!$("#info-page").hidden) return;
    if (location.pathname === "/products") { showShopPage(); return; }
    const productRoute = location.pathname.match(/^\/products\/([a-z0-9-]{1,64})$/);
    if (productRoute) { showProductPage(productRoute[1]); return; }
    showRail();
    renderLooks();
    followCategoryHash();
    // product pages link to "/#look-N" to open that look directly
    const lookHash = location.hash.match(/^#look-(\d+)$/);
    if (lookHash && looks[Number(lookHash[1])]) {
      lookIndex = Number(lookHash[1]);
      setPaused(true);
      showLook();
      $("#looks").scrollIntoView();
    }
  } catch {
    if (!$("#info-page").hidden) return;
    $("#catalog-note").textContent = "Цуглуулгыг ачаалж чадсангүй. Хуудсаа шинэчилнэ үү.";
    $("#looks").hidden = true;
  }
}
initialize();
