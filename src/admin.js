const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const money = amount => new Intl.NumberFormat("mn-MN").format(amount) + " ₮";
const media = key => "/media/" + encodeURIComponent(key);
const categories = { tops:"Дээгүүр", bottoms:"Өмд", outerwear:"Гадуур хувцас", accessories:"Аксессуар" };
let catalog = { products:[], looks:[] };
let editingProduct = null;
let editingLook = null;

function message(text, error = false) {
  const element = $("#admin-message");
  element.classList.toggle("error", error);
  element.textContent = text;
}
async function api(path, options) {
  const response = await fetch("/api/admin/" + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Дахин оролдоно уу.");
  return data;
}
const post = (path, data) => api(path, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(data) });
async function refreshCatalog() {
  catalog = await api("catalog");
  $("#products-list").innerHTML = catalog.products.map(item => '<button class="secondary" type="button" data-id="' + esc(item.id) + '">' +
    esc(item.brand) + " · " + esc(item.title) + (item.active ? "" : " · Ноорог") + '</button>').join("");
  $("#looks-list").innerHTML = catalog.looks.map(item => '<button class="secondary" type="button" data-id="' + esc(item.id) + '">' +
    esc(item.title) + (item.active ? "" : " · Ноорог") + '</button>').join("");
}
async function upload(file) {
  if (!["image/webp","image/jpeg","image/png"].includes(file.type) || file.size > 16_000_000) {
    throw new Error("16 МБ хүртэл хэмжээтэй PNG, JPEG эсвэл WebP зураг сонгоно уу.");
  }
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1400 / Math.max(image.width,image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .86));
    if (!data || data.type !== "image/webp") throw new Error("Зураг боловсруулахад алдаа гарлаа.");
    return (await api("image", { method:"POST", headers:{ "Content-Type":data.type }, body:data })).key;
  } finally { image.close(); }
}
function variantRow(variant = {}) {
  return '<div class="variant" data-id="' + esc(variant.id) + '" data-version="' + (variant.version ?? 0) + '">' +
    '<label>Хэмжээ<input name="size" required maxlength="35" value="' + esc(variant.size) + '"></label>' +
    '<label>Өнгө<input name="color" required maxlength="35" value="' + esc(variant.color) + '"></label>' +
    '<label>Үнэ (₮)<input name="price" type="number" required min="1" max="1000000000" value="' + esc(variant.price) + '"></label>' +
    '<label>Үлдэгдэл<input name="stock" type="number" required min="0" max="1000000" value="' + (variant.stock ?? 0) + '"></label>' +
    (variant.id ? '<label class="inline"><input type="checkbox" name="enabled"' + (variant.active ? ' checked' : '') + '>Идэвхтэй</label>' :
      '<button class="secondary" type="button" data-remove-variant>Хасах</button>') + '</div>';
}
function uploadField(name, key, label) {
  return '<label>' + label + '<input name="' + name + '" type="file" accept="image/webp,image/jpeg,image/png"></label><img class="admin-photo" data-preview="' +
    name + '" alt="' + label + '"' + (key ? ' src="' + esc(media(key)) + '"' : ' hidden') + '>';
}
// Checks a Try the Look photo before upload: the storefront lines looks up side by side on white,
// so it needs a see-through background and an upright (portrait) full-body frame.
async function inspectCutout(file) {
  const image = await createImageBitmap(file);
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently:true });
    context.drawImage(image, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    let edge = 0, clear = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (x > 1 && y > 1 && x < size - 2 && y < size - 2) continue;
      edge++;
      if (data[(y * size + x) * 4 + 3] < 16) clear++;
    }
    const problems = [];
    if (clear / edge < .6) problems.push("дэвсгэртэй байна — дэвсгэргүй (тунгалаг) PNG эсвэл WebP оруулна уу");
    if (image.width >= image.height) problems.push("хэвтээ байна — хүн толгойноос хөл хүртэл багтсан босоо зураг оруулна уу");
    return problems;
  } finally { image.close(); }
}
function bindImage(form, name, onSaved, check) {
  const input = form.elements[name];
  input.addEventListener("change", async () => {
    if (!input.files[0]) return;
    if (check) await check(input.files[0]);
    form.querySelector("button[type=submit]").disabled = true;
    const prior = form.dataset.uploads ?? "0";
    form.dataset.uploads = String(Number(prior) + 1);
    input.disabled = true;
    message("Зураг оруулж байна…");
    try {
      const key = await upload(input.files[0]);
      const preview = form.querySelector('[data-preview="' + name + '"]');
      if (preview) {
        preview.src = media(key);
        preview.hidden = false;
      }
      onSaved(key);
      message("Зураг бэлэн.");
    } catch (error) { message(error.message, true); }
    finally {
      form.dataset.uploads = String(Number(form.dataset.uploads) - 1);
      form.querySelector("button[type=submit]").disabled = Number(form.dataset.uploads) > 0;
      input.disabled = false;
    }
  });
}
function editProduct(item = {}) {
  editingProduct = { ...item };
  const draft = editingProduct;
  $("#product-editor").innerHTML = '<form id="product-editor-form" class="form-grid"><h2>' + (item.id ? "Бүтээгдэхүүн засах" : "Шинэ бүтээгдэхүүн") +
    '</h2><label>Нэр<input name="title" required maxlength="100" value="' + esc(item.title) + '"></label>' +
    '<label>Брэнд<input name="brand" required maxlength="80" value="' + esc(item.brand) + '"></label>' +
    '<label>Ангилал<select name="category">' + Object.entries(categories).map(([key,label]) =>
      '<option value="' + key + '"' + (item.category === key ? " selected" : "") + '>' + label + '</option>').join("") + '</select></label>' +
    '<label>Тайлбар<textarea name="description" maxlength="2500">' + esc(item.description) + '</textarea></label>' +
    uploadField("hanger", item.image, "Өлгүүрийн үндсэн зураг") + uploadField("front", item.front_image, "Урд талын зураг (заавал биш)") +
    '<small>Тунгалаг дэвсгэртэй, өлгүүр нь бүтэн харагдах зураг тохиромжтой.</small>' +
    '<fieldset><legend>Хэмжээ, өнгө, үлдэгдэл</legend><div id="variant-list">' +
    (item.variants ?? [{}]).map(variantRow).join("") + '</div><button class="secondary" id="add-variant" type="button">Сонголт нэмэх</button></fieldset>' +
    '<label class="inline"><input name="active" type="checkbox"' + (item.active ? " checked" : "") + '>Дэлгүүрт харуулах</label><button class="primary" type="submit">Хадгалах</button></form>';
  const form = $("#product-editor-form");
  bindImage(form, "hanger", key => { draft.image = key; });
  bindImage(form, "front", key => { draft.front_image = key; });
  $("#add-variant").addEventListener("click", () => {
    if ($("#variant-list").children.length < 30) $("#variant-list").insertAdjacentHTML("beforeend", variantRow());
  });
  $("#variant-list").addEventListener("click", event => {
    if (event.target.closest("[data-remove-variant]") && $("#variant-list").children.length > 1) event.target.closest(".variant").remove();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const fields = form.elements;
      const variants = [...form.querySelectorAll(".variant")].map(row => ({
        id:row.dataset.id || undefined, version:Number(row.dataset.version),
        size:row.querySelector('[name="size"]').value, color:row.querySelector('[name="color"]').value,
        price:Number(row.querySelector('[name="price"]').value), stock:Number(row.querySelector('[name="stock"]').value),
        active:row.querySelector('[name="enabled"]')?.checked ?? true
      }));
      const result = await post("product", { id:draft.id, image:draft.image, front_image:draft.front_image,
        title:fields.title.value, brand:fields.brand.value, description:fields.description.value,
        category:fields.category.value, active:fields.active.checked, variants });
      await refreshCatalog();
      if (editingProduct === draft) editProduct(catalog.products.find(product => product.id === result.id));
      message("Бүтээгдэхүүнийг хадгаллаа.");
    } catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
}
function showPinEditor(form, draft) {
  const target = $("#pin-image");
  target.innerHTML = draft.image ? '<img class="admin-photo" alt="Хослолын зураг" src="' + esc(media(draft.image)) + '">' +
    draft.pins.map((pin,index) => '<span class="hotspot" style="left:' + pin.x + '%;top:' + pin.y + '%;display:grid;place-items:center;pointer-events:none">' +
    (index + 1) + '</span>').join("") : '';
  $("#pin-list").innerHTML = draft.pins.map((pin,index) => '<li>' + esc(catalog.products.find(product => product.id === pin.product)?.title) +
    ' <button class="secondary" type="button" data-remove-pin="' + index + '">Хасах</button></li>').join("");
}
function editLook(item = {}) {
  editingLook = { ...item, pins:(item.pins ?? []).map(pin => ({ ...pin })) };
  const draft = editingLook;
  $("#look-editor").innerHTML = '<form id="look-editor-form" class="form-grid"><h2>Try the Look</h2>' +
    '<label>Хослолын нэр<input name="title" maxlength="100" required value="' + esc(item.title) + '"></label>' +
    '<label>Хослолын зураг — бүтэн биетэй, дэвсгэргүй<input name="look_image" type="file" accept="image/png,image/webp,image/jpeg"></label>' +
    '<div class="look-guide"><p>Дэлгүүрт хослолууд цагаан дэвсгэр дээр зэрэгцэн харагдана. Хамгийн гоё харагдахын тулд:</p><ul>' +
    '<li>Загвар өмсөгчийн <strong>толгойноос хөл хүртэл</strong> бүтэн харагдах босоо зураг</li>' +
    '<li><strong>Дэвсгэргүй (тунгалаг)</strong> PNG эсвэл WebP — JPEG дэвсгэргүй байж чадахгүй</li>' +
    '<li>Хүн голдоо, хөл нь зургийн доод ирмэгт ойрхон, дээр доор илүү зай бага</li>' +
    '<li>Бүх хослолд ижил зай, ижил гэрэлтүүлэг — тэгвэл эгнээ жигд харагдана</li></ul></div>' +
    '<p id="look-check" class="look-check" role="status" hidden></p>' +
    '<label>Цэг дээр харуулах бүтээгдэхүүн<select name="product">' + catalog.products.map(product =>
      '<option value="' + esc(product.id) + '">' + esc(product.brand + " · " + product.title) + '</option>').join("") + '</select></label>' +
    '<p class="muted">Бүтээгдэхүүнээ сонгоод зураг дээр байрлалыг нь дарна уу. Шатрын хөлөг шиг нүд харагдаж байвал дэвсгэр нь тунгалаг байна.</p><div><div class="pin-target" id="pin-image"></div></div>' +
    '<ol id="pin-list"></ol><label class="inline"><input name="active" type="checkbox"' + (item.active ? " checked" : "") +
    '>Дэлгүүрт харуулах</label><button type="submit" class="primary">Хадгалах</button></form>';
  const form = $("#look-editor-form");
  showPinEditor(form, draft);
  bindImage(form, "look_image", key => {
    draft.image = key;
    draft.pins = [];
    showPinEditor(form, draft);
  }, async file => {
    const note = $("#look-check");
    const problems = await inspectCutout(file).catch(() => []);
    note.hidden = false;
    note.classList.toggle("ok", !problems.length);
    note.textContent = problems.length ? "Анхаар: энэ зураг " + problems.join("; ") + ". Хадгалж болно, гэхдээ дэлгүүрт жигд харагдахгүй." :
      "Зураг тохирч байна: дэвсгэргүй, босоо.";
  });
  $("#pin-image").addEventListener("click", event => {
    const product = form.elements.product.value;
    const image = event.currentTarget.querySelector("img");
    if (!image || !product || draft.pins.length >= 8) return;
    const rect = image.getBoundingClientRect();
    const percent = (position, dimension) => Math.min(100, Math.max(0, Math.round(1000 * position / dimension) / 10));
    draft.pins.push({ product, x:percent(event.clientX - rect.left, rect.width), y:percent(event.clientY - rect.top, rect.height) });
    showPinEditor(form, draft);
  });
  $("#pin-list").addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-pin]");
    if (!remove) return;
    draft.pins.splice(Number(remove.dataset.removePin), 1);
    showPinEditor(form, draft);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      if (!draft.image || !draft.pins.length) throw new Error("Зураг болон дор хаяж нэг бүтээгдэхүүний цэг оруулна уу.");
      const result = await post("look", { id:draft.id, image:draft.image, pins:draft.pins, title:form.elements.title.value, active:form.elements.active.checked });
      await refreshCatalog();
      if (editingLook === draft) editLook(catalog.looks.find(look => look.id === result.id));
      message("Хослолыг хадгаллаа.");
    } catch (error) { message(error.message,true); }
    finally { button.disabled = false; }
  });
}
async function showOrders() {
  const target = $("#orders-list");
  try {
    const orders = await api("orders");
    const names = { pending:"Хүлээгдэж буй", paid:"Төлсөн", shipped:"Хүргэлтэд гарсан", canceled:"Цуцлагдсан" };
    target.innerHTML = orders.length ? orders.map(order => '<article class="admin-order"><strong>' + esc(order.id.slice(0,8)) +
      ' · ' + names[order.status] + ' · ' + money(order.amount) + '</strong><small>' +
      new Intl.DateTimeFormat("mn-MN", { timeZone:"Asia/Ulaanbaatar", dateStyle:"medium", timeStyle:"short" }).format(order.created * 1000) +
      '</small><p>' + esc(order.buyer) + ' · ' + esc(order.phone) + '</p><p>' + esc(order.province) + ' · ' + esc(order.address) +
      '</p><ul>' + order.items.map(item => '<li>' + esc(item.brand + " · " + item.title + " · " + item.size + " / " + item.color) +
      ' × ' + item.quantity + '</li>').join("") + '</ul>' + (order.tracking ? '<p>Хүргэлтийн дугаар ' + esc(order.tracking) + '</p>' : '') +
      (order.status === "paid" ? '<form data-order="' + esc(order.id) +
      '"><label>Хүргэлтийн дугаар<input name="tracking" maxlength="100"></label><button class="primary">Хүргэлтэд гаргах</button></form>' : '') +
      '</article>').join("") : "<p>Захиалга алга байна.</p>";
  } catch (error) { target.textContent = error.message; }
}
for (const button of document.querySelectorAll("[data-panel]")) {
  button.addEventListener("click", () => {
    for (const panel of ["products","looks","orders"]) $("#" + panel + "-panel").hidden = panel !== button.dataset.panel;
    if (button.dataset.panel === "orders") showOrders();
  });
}
$("#new-product").addEventListener("click", () => editProduct());
$("#new-look").addEventListener("click", () => editLook());
$("#products-list").addEventListener("click", event => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  if (id) editProduct(catalog.products.find(item => item.id === id));
});
$("#looks-list").addEventListener("click", event => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  if (id) editLook(catalog.looks.find(item => item.id === id));
});
$("#refresh-orders").addEventListener("click", showOrders);
$("#orders-list").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await post("ship", { id:form.dataset.order, tracking:form.elements.tracking.value });
    await showOrders();
    message("Хүргэлтийн төлөвийг шинэчиллээ.");
  } catch (error) { message(error.message,true); }
  finally { button.disabled = false; }
});
refreshCatalog().then(() => { editProduct(); editLook(); }).catch(error => message(error.message,true));
