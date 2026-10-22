// Scheduled every hour. Starts each feed's daily run at/after its configured Lisbon hour,
// once per day, retrying up to 3 times (one per hour) if a run fails.
import { listFeeds, db, K } from "../lib/store.mjs";
import { hourLisbon, todayLisbon } from "../lib/util.mjs";
import { triggerRun } from "../lib/http.mjs";

export default async () => {
  const hour = hourLisbon();
  const today = todayLisbon();
  const origin = process.env.URL;
  for (const f of await listFeeds()) {
    const cfg = await db.get(K.config(f.id));
    if (!cfg || cfg.scheduleEnabled === false || hour < Number(cfg.runHour)) continue;
    const state = await db.get(K.state(f.id));
    if (state?.lastRunDate === today) continue;
    const schedKey = `feeds/${f.id}/sched`;
    const sched = (await db.get(schedKey)) || {};
    const attempts = sched.date === today ? sched.attempts : 0;
    if (attempts >= 3) continue;
    try {
      await db.set(schedKey, { date: today, attempts: attempts + 1 });
      await triggerRun(origin, { feedId: f.id, mode: "full", trigger: "schedule" });
      console.log(`[feedforge] run agendado iniciado: ${f.id} (tentativa ${attempts + 1})`);
    } catch (e) {
      console.error(`[feedforge] falha ao iniciar ${f.id}: ${e.message}`);
    }
  }
};

export const config = { schedule: "@hourly" };
