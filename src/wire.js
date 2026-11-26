const encoder = new TextEncoder();
const wireIdPattern = /^pi_[a-zA-Z0-9]+$/;

async function wireRequest(env, path, data, key) {
  const headers = { Authorization: "Bearer " + env.WIRE_API_KEY };
  if (data) {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = key;
  }
  const response = await fetch("https://api.wire.mn/v1" + path, {
    method: data ? "POST" : "GET", headers,
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(7000), redirect: "error"
  });
  if (!response.ok) throw new Error("Wire returned HTTP " + response.status);
  return response.json();
}

async function verifyWire(secret, header, body, now = Date.now()) {
  if (!secret) return false;
  const parts = new URLSearchParams(header.replaceAll(",", "&"));
  const timestamp = parts.get("t");
  if (!/^\d{10}$/.test(timestamp ?? "") || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const payload = new Uint8Array(11 + body.length);
  payload.set(encoder.encode(timestamp + "."));
  payload.set(body, 11);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const signature of parts.getAll("v1")) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) continue;
    const bytes = Uint8Array.from(signature.match(/../g), pair => parseInt(pair, 16));
    if (await crypto.subtle.verify("HMAC", key, bytes, payload)) return true;
  }
  return false;
}
