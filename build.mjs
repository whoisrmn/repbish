import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const pageFiles = { shopHtml: "shop.html", adminHtml: "admin.html", clientJs: "client.js", adminJs: "admin.js", storeCss: "store.css" };
const pages = Object.fromEntries(await Promise.all(Object.entries(pageFiles).map(async ([name, file]) =>
  [name, await readFile(new URL("./src/" + file, import.meta.url), "utf8")]
)));
pages.demo = Object.fromEntries(await Promise.all(["hanger-HOODIE","hanger-TEE","hanger-TROUSERS","hanger-CAP","look"].map(async name =>
  [name, (await readFile(new URL("./src/demo/" + name + ".webp", import.meta.url))).toString("base64")]
)));
// self-hosted Inter font files, served at /fonts/<name>.woff2
pages.fonts = Object.fromEntries(await Promise.all(["inter-latin","inter-latin-ext","inter-cyrillic","inter-cyrillic-ext"].map(async name =>
  [name, (await readFile(new URL("./src/fonts/" + name + ".woff2", import.meta.url))).toString("base64")]
)));
const server = await readFile(new URL("./src/worker.js", import.meta.url), "utf8");
const wire = await readFile(new URL("./src/wire.js", import.meta.url), "utf8");
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", "const assets = " + JSON.stringify(pages) + "\n" + wire + "\n" + server);
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
