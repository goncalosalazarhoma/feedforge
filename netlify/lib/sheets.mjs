// Google Sheets writer using a service account (JWT signed with node:crypto — no googleapis dependency).
import crypto from "node:crypto";

let cachedToken = null;

function serviceAccount() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada");
  raw = raw.trim();
  if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8"); // allow base64
  const sa = JSON.parse(raw);
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}

export function serviceAccountEmail() {
  try { return serviceAccount().client_email; } catch { return null; }
}

async function token() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google auth falhou: ${await res.text()}`);
  const j = await res.json();
  cachedToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cachedToken.value;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 403 || res.status === 404) {
      throw new Error(`Sem acesso à Google Sheet (${res.status}). Partilha a sheet como Editor com ${serviceAccountEmail()}. ${t.slice(0, 200)}`);
    }
    throw new Error(`Sheets API ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

const q = (tab) => `'${tab.replace(/'/g, "''")}'`;

/** Replace the whole content of a tab with headers + rows. Returns { gid, rows }. */
export async function writeTab(spreadsheetId, tab, headers, rows) {
  const meta = await api(`${spreadsheetId}?fields=sheets.properties`);
  let sheet = meta.sheets.find((s) => s.properties.title === tab);
  if (!sheet) {
    const r = await api(`${spreadsheetId}:batchUpdate`, { method: "POST", body: { requests: [{ addSheet: { properties: { title: tab } } }] } });
    sheet = { properties: r.replies[0].addSheet.properties };
  }
  const gid = sheet.properties.sheetId;
  const values = [headers, ...rows.map((r) => headers.map((h) => String(r[h] ?? "")))];

  const grid = sheet.properties.gridProperties || { rowCount: 1000, columnCount: 26 };
  const resize = (rowCount, columnCount) => api(`${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: gid, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } },
          fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
        },
      }],
    },
  });
  const needRows = Math.max(values.length, 2);
  const needCols = Math.max(headers.length, 1);

  // 1) grow the grid if needed (never clear first: the public CSV is never empty mid-run)
  if (grid.rowCount < needRows || grid.columnCount < needCols) {
    await resize(Math.max(grid.rowCount, needRows), Math.max(grid.columnCount, needCols));
  }
  // 2) overwrite values — RAW keeps EANs with leading zeros and "12.00 EUR" as plain text
  const CHUNK = 4000;
  for (let i = 0; i < values.length; i += CHUNK) {
    const range = `${q(tab)}!A${i + 1}`;
    await api(`${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: "PUT",
      body: { range, majorDimension: "ROWS", values: values.slice(i, i + CHUNK) },
    });
  }
  // 3) shrink to exact size so removed products / old columns disappear
  await resize(needRows, needCols);
  return { gid, rows: rows.length };
}

export function csvExportUrl(spreadsheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}
