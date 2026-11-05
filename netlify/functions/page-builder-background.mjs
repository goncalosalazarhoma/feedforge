// Background function: one Page Builder generation (Claude can take longer than a synchronous function allows).
// The UI polls GET /api/page-builder/jobs/:id. Not a pipeline run — nothing is reported to Filo.
import { db } from "../lib/store.mjs";
import { authorized } from "../lib/http.mjs";
import { PBK, generate } from "../lib/page-builder.mjs";

export async function runJob(jobId) {
  const job = await db.get(PBK.job(jobId));
  if (!job || job.status !== "running") return job;
  try {
    const result = await generate(job.input || {});
    const done = { id: jobId, status: "done", startedAt: job.startedAt, finishedAt: new Date().toISOString(), result };
    await db.set(PBK.job(jobId), done);
    return done;
  } catch (e) {
    console.error("[page-builder]", e);
    const failed = { id: jobId, status: "error", startedAt: job.startedAt, finishedAt: new Date().toISOString(), error: e.message };
    await db.set(PBK.job(jobId), failed);
    return failed;
  }
}

export default async (req) => {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { jobId } = await req.json().catch(() => ({}));
  if (jobId) await runJob(jobId);
  return new Response("", { status: 202 });
};
