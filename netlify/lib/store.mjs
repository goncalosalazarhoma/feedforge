// Storage layer — Netlify Blobs in production, in-memory map for local tests.
import { getStore } from "@netlify/blobs";

let memory = null; // set by tests via useMemoryStore()

export function useMemoryStore() {
  memory = new Map();
  return memory;
}

function store() {
  if (memory) {
    return {
      async get(k) { return memory.has(k) ? structuredClone(memory.get(k)) : null; },
      async setJSON(k, v) { memory.set(k, structuredClone(v)); },
      async delete(k) { memory.delete(k); },
    };
  }
  const s = getStore({ name: "feedforge", consistency: "strong" });
  return {
    get: (k) => s.get(k, { type: "json" }),
    setJSON: (k, v) => s.setJSON(k, v),
    delete: (k) => s.delete(k),
  };
}

export const db = {
  get: (k) => store().get(k),
  set: (k, v) => store().setJSON(k, v),
  del: (k) => store().delete(k),
};

// ---- key helpers -------------------------------------------------------
export const K = {
  feeds: () => "feeds/index",
  config: (f) => `feeds/${f}/config`,
  state: (f) => `feeds/${f}/state`,          // hashes, firstSeen, queue (owned by the run)
  ai: (f) => `feeds/${f}/ai`,                // { [id]: { fields:{...}, inputHash, at } }
  aiRequests: (f) => `feeds/${f}/ai-requests`, // ids the UI asked to (re)optimise
  overrides: (f) => `feeds/${f}/overrides`,  // { [id]: { field: value } }
  source: (f) => `feeds/${f}/source`,        // { headers, rows, fetchedAt }
  output: (f) => `feeds/${f}/output`,        // { meta:{headers,rows}, gmc:{headers,rows}, flags, excluded }
  runs: (f) => `feeds/${f}/runs`,            // [ runLog ]
  lock: (f) => `feeds/${f}/lock`,
  ruleCache: (f) => `feeds/${f}/rule-cache`, // { key, items: { [id]: { k, d, ex, ap, bl } } }
};

export async function listFeeds() {
  return (await db.get(K.feeds())) || [];
}

export async function getConfig(feedId) {
  const c = await db.get(K.config(feedId));
  if (!c) throw httpError(404, `Feed "${feedId}" não existe`);
  return c;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
