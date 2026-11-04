// Local test for the Filo run report (mocked Filo endpoint). Run: npm test
import assert from "node:assert/strict";
import { useMemoryStore, db, K } from "../netlify/lib/store.mjs";
import { defaultConfig } from "../netlify/lib/defaults.mjs";
import { buildFiloPayload, reportToFilo } from "../netlify/lib/filo.mjs";

useMemoryStore();
const cfg = defaultConfig({ id: "pt", name: "hôma PT", language: "pt-PT" });
const baseLog = { id: "1730700000000", mode: "full", startedAt: "2026-11-03T23:30:00.000Z", finishedAt: "2026-11-03T23:32:03.000Z", steps: [], status: "ok", diff: { new: 10, removed: 2, changedContent: 300, changedLocked: 2, unchanged: 9000 } };

// ---- clean run: metrics per market, Lisbon date, no alert
let p = buildFiloPayload({ feedId: "pt", cfg, log: { ...baseLog, ai: { optimized: 5, failed: 0, errors: 0 } } });
assert.equal(p.catalog.length, 2);
assert.deepEqual(p.metrics.map((m) => [m.key, m.value, m.date, m.dimensions.market]), [["feed_products_changed", 312, "2026-11-03", "PT"], ["feed_errors", 0, "2026-11-03", "PT"]]);
assert.equal(p.events[0].data.status, "success");
assert.equal(p.events[0].data.duration_s, 123);
assert.equal(p.alerts.length, 0);

// ---- partial: AI failures → warning alert
p = buildFiloPayload({ feedId: "pt", cfg, log: { ...baseLog, ai: { optimized: 5, failed: 4, errors: 1 }, steps: [{ msg: "Erro AI: timeout" }] } });
assert.equal(p.events[0].data.status, "partial");
assert.equal(p.metrics[1].value, 4);
assert.equal(p.alerts[0].severity, "warning");
assert.match(p.alerts[0].title, /4 errors/);
assert.match(p.alerts[0].message, /timeout/);

// ---- failed run → critical alert; unknown market → no dimensions; rebuild → no daily metrics
p = buildFiloPayload({ feedId: "x", cfg: { name: "x" }, log: { ...baseLog, status: "error" }, error: new Error("Abortado por segurança") });
assert.equal(p.events[0].data.status, "failed");
assert.equal(p.alerts[0].severity, "critical");
assert.ok(p.metrics.every((m) => !("dimensions" in m)));
assert.equal(buildFiloPayload({ feedId: "pt", cfg, log: { ...baseLog, mode: "rebuild" } }).metrics.length, 0);
assert.equal(buildFiloPayload({ feedId: "pt", cfg, log: { mode: "full" }, error: new Error("lock") }).metrics.length, 0, "run never started → no metrics");
console.log("Payload OK");

// ---- sending: skip without env, retry on 5xx, never throw
const calls = [];
let replies = [];
globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); const r = replies.shift(); if (r instanceof Error) throw r; return new Response(JSON.stringify(r.body), { status: r.status }); };
delete process.env.FILO_INBOX_URL;
await reportToFilo(p);
assert.equal(calls.length, 0, "no env → skipped");
process.env.FILO_INBOX_URL = "https://filo.test/api/public/integrations/feedforge";
process.env.FILO_API_KEY = "k";
replies = [{ status: 503, body: {} }, { status: 200, body: { ok: true, accepted: { metrics: 2 }, rejected: [{ key: "x" }] } }];
const res = await reportToFilo(p);
assert.equal(calls.length, 2, "retried once after 503");
assert.equal(calls[0].opts.headers.Authorization, "Bearer k");
assert.equal(res.ok, true);
calls.length = 0;
replies = [{ status: 401, body: { error: "bad key" } }];
await reportToFilo(p);
assert.equal(calls.length, 1, "4xx is not retried");
console.log("Send OK");

// ---- end to end: a failing run still reports, and the background function does not throw
calls.length = 0;
replies = [{ status: 200, body: { ok: true, accepted: {}, rejected: [] } }];
process.env.APP_PASSWORD = "pw";
await db.set(K.config("pt"), { ...cfg, sourceUrl: "" }); // no source URL → run fails
const handler = (await import("../netlify/functions/run-background.mjs")).default;
await handler(new Request("https://x.test/.netlify/functions/run-background", { method: "POST", headers: { authorization: "Bearer pw" }, body: JSON.stringify({ feedId: "pt" }) }));
const sent = JSON.parse(calls[0].opts.body);
assert.equal(sent.events[0].data.status, "failed");
assert.equal(sent.alerts[0].severity, "critical");
console.log("Run report OK");

console.log("\n✅ testes Filo passaram");
