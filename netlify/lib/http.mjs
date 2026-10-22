import crypto from "node:crypto";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

export function authorized(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false; // refuse everything until a password is configured
  const h = req.headers.get("authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function triggerRun(origin, body) {
  const res = await fetch(`${origin}/.netlify/functions/run-background`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 202 && !res.ok) throw new Error(`Não foi possível iniciar o run (${res.status})`);
}
