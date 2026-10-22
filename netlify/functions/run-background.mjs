// Background function (up to 15 min): runs the full pipeline for one feed.
import { runFeed } from "../lib/pipeline.mjs";
import { authorized } from "../lib/http.mjs";

export default async (req) => {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { feedId, mode = "full", trigger = "manual" } = await req.json().catch(() => ({}));
  if (!feedId) return new Response("feedId em falta", { status: 400 });
  try {
    const log = await runFeed(feedId, { mode, trigger, deadline: Date.now() + 14 * 60 * 1000 });
    console.log(`[feedforge] ${feedId} ${mode} ok`, JSON.stringify(log.diff || {}), JSON.stringify(log.output || {}));
  } catch (e) {
    console.error(`[feedforge] ${feedId} ${mode} falhou:`, e.message);
  }
};
