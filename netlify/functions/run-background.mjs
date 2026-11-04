// Background function (up to 15 min): runs the full pipeline for one feed.
import { runFeed } from "../lib/pipeline.mjs";
import { authorized } from "../lib/http.mjs";
import { db, K } from "../lib/store.mjs";
import { reportRun } from "../lib/filo.mjs";

export default async (req) => {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { feedId, mode = "full", trigger = "manual" } = await req.json().catch(() => ({}));
  if (!feedId) return new Response("feedId em falta", { status: 400 });
  let log = null, error = null;
  try {
    log = await runFeed(feedId, { mode, trigger, deadline: Date.now() + 14 * 60 * 1000 });
    console.log(`[feedforge] ${feedId} ${mode} ok`, JSON.stringify(log.diff || {}), JSON.stringify(log.output || {}));
  } catch (e) {
    error = e;
    log = e.log || { mode };
    console.error(`[feedforge] ${feedId} ${mode} falhou:`, e.message);
  }
  // report to Filo (never throws, never affects the run)
  const cfg = await db.get(K.config(feedId)).catch(() => null);
  await reportRun({ feedId, cfg, log, error });
};
