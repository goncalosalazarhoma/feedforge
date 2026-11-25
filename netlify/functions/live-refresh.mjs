// Every 2 hours: live SFCC price / promotions / stock for the SKUs of active folhetos (light, incremental, no AI).
import { refreshLive } from "../lib/live.mjs";

export default async () => {
  const s = await refreshLive({ trigger: "schedule" });
  console.log(`[feedforge] live: ${s.sets} listas, ${s.skus} SKUs, ${s.calls} pedidos SFCC, ${s.durationMs} ms${s.error ? ` — erro: ${s.error}` : ""}${s.newAlerts?.length ? ` — alertas novos em ${s.newAlerts.length} lista(s)` : ""}`);
};

export const config = { schedule: "0 */2 * * *" };
