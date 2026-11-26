// Production server for a plain Node host (VPS behind Nginx), as an alternative to Cloudflare Workers.
// Runs the built worker (dist/server/index.js) with SQLite and filesystem image storage.
//
// Environment:
//   PORT            local port to listen on (default 4320); bind is 127.0.0.1 only, Nginx proxies to it
//   PUBLIC_ORIGIN   the public origin, e.g. https://larp1t.space (used for links and the same-origin check)
//   BASE_PATH       sub-path the store is served under, e.g. /repbish (Nginx strips it before proxying)
//   DATA_DIR        where the database and uploaded images live (default ./data)
//   ADMIN_PASSWORD  password for /admin (user name "admin"); without it the admin is switched off
//
// Checkout stays off unless CHECKOUT_ENABLED, WIRE_API_KEY and WIRE_WEBHOOK_SECRET are set.
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { timingSafeEqual, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { localDb } from "./local-db.mjs";
import worker from "./dist/server/index.js";

const port = Number(process.env.PORT ?? 4320);
const origin = (process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:" + port).replace(/\/+$/, "");
const dataDir = (process.env.DATA_DIR ?? "./data").replace(/\/+$/, "");
const adminPassword = process.env.ADMIN_PASSWORD ?? "";
const ownerEmail = "owner@repbish.local";

await mkdir(dataDir + "/media", { recursive: true });
const environment = {
  DB: localDb(dataDir + "/store.sqlite"),
  BUCKET: {
    async get(key) {
      try {
        const data = await readFile(dataDir + "/media/" + key);
        const extension = key.split(".").at(-1);
        return { body: data, httpMetadata: { contentType: "image/" + (extension === "jpg" ? "jpeg" : extension) } };
      } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    put: (key, data) => writeFile(dataDir + "/media/" + key, data)
  },
  ADMIN_EMAIL: ownerEmail,
  BASE_PATH: process.env.BASE_PATH ?? "",
  CHECKOUT_ENABLED: process.env.CHECKOUT_ENABLED,
  WIRE_API_KEY: process.env.WIRE_API_KEY,
  WIRE_WEBHOOK_SECRET: process.env.WIRE_WEBHOOK_SECRET
};

const digest = text => createHash("sha256").update(text).digest();
// HTTP Basic auth for the admin: user "admin" and ADMIN_PASSWORD (compared in constant time)
function isOwner(header) {
  if (!adminPassword || !header?.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
  return user === "admin" && timingSafeEqual(digest(rest.join(":")), digest(adminPassword));
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      // identity headers only ever come from this server, never from the visitor
      if (!name.startsWith("oai-") && value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    if (url.pathname === "/admin" || url.pathname.startsWith("/api/admin/")) {
      if (!isOwner(incoming.headers.authorization)) {
        outgoing.writeHead(401, { "WWW-Authenticate": 'Basic realm="Repbish admin", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
        outgoing.end(adminPassword ? "Нэвтрэх шаардлагатай." : "Admin is switched off on this server.");
        return;
      }
      headers.set("oai-authenticated-user-id", "owner");
      headers.set("oai-authenticated-user-email", ownerEmail);
    }
    const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : Readable.toWeb(incoming);
    const result = await worker.fetch(new Request(url, { method: incoming.method, headers, body, duplex: "half" }), environment,
      { waitUntil: promise => promise.catch(() => {}) });
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body && incoming.method !== "HEAD") await pipeline(Readable.fromWeb(result.body), outgoing);
    else outgoing.end();
  } catch (error) {
    console.error(error.message);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(port, "127.0.0.1", () => console.log("Repbish on 127.0.0.1:" + port + " · public " + origin + (environment.BASE_PATH || "") +
  (adminPassword ? "" : " · admin off (no ADMIN_PASSWORD)")));
