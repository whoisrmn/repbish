import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { localDb } from "./local-db.mjs";

const paths = {
  "/": ["shop.html","text/html; charset=utf-8"],
  "/style.css": ["store.css","text/css; charset=utf-8"],
  "/shop.js": ["client.js","text/javascript; charset=utf-8"],
  "/admin": ["admin.html","text/html; charset=utf-8"],
  "/admin.js": ["admin.js","text/javascript; charset=utf-8"]
};
const port = Number(process.env.REPBISH_PORT ?? 4317);
const origin = "http://127.0.0.1:" + port;
await mkdir(".local/media", { recursive:true });
const DB = localDb(".local/preview.sqlite");
const BUCKET = {
  async get(key) {
    try {
      const data = await readFile(".local/media/" + key);
      const extension = key.split(".").at(-1);
      return { body:data, httpMetadata:{ contentType: "image/" + (extension === "jpg" ? "jpeg" : extension) } };
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  },
  put: (key, data) => writeFile(".local/media/" + key, data)
};
const environment = { DB, BUCKET, ADMIN_EMAIL:"local@repbish.test" };
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (incoming.method === "GET") {
      const file = paths[url.pathname] ?? (url.pathname.startsWith("/order/") ? paths["/"] : null);
      if (file) {
        const source = await readFile(new URL("./src/" + file[0], import.meta.url));
        outgoing.writeHead(200, { "Content-Type":file[1], "Cache-Control":"no-store" }).end(source);
        return;
      }
      if (/^\/demo\/(?:hanger-(?:HOODIE|TEE|TROUSERS|CAP)|look)$/.test(url.pathname)) {
        const source = createReadStream(new URL("./src" + url.pathname + ".webp", import.meta.url));
        outgoing.writeHead(200, { "Content-Type":"image/webp" });
        await pipeline(source, outgoing);
        return;
      }
    }
    const compiled = new URL("./dist/server/index.js", import.meta.url);
    compiled.searchParams.set("updated", (await stat(compiled)).mtimeMs);
    const handler = (await import(compiled)).default;
    const headers = new Headers(incoming.headers);
    headers.set("oai-authenticated-user-id", "local-owner");
    headers.set("oai-authenticated-user-email", environment.ADMIN_EMAIL);
    const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : Readable.toWeb(incoming);
    const result = await handler.fetch(new Request(url, { method:incoming.method, headers, body, duplex:"half" }), environment,
      { waitUntil:promise => promise.catch(() => {}) });
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) await pipeline(Readable.fromWeb(result.body), outgoing);
    else outgoing.end();
  } catch (error) {
    console.error(error.message);
    if (!outgoing.headersSent) outgoing.writeHead(503);
    outgoing.end("Preview is rebuilding.");
  }
});
server.listen(port, "127.0.0.1", () => console.log("Repbish preview: " + origin));
