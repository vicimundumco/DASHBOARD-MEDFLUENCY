import crypto from "node:crypto";
import { appointmentHistory } from "../lib/appointment-history.js";

const META_GRAPH = "https://graph.facebook.com/v21.0";
const DEFAULT_ACCOUNTS = [];

const normal = (value = "") => String(value)
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const asNumber = (value) => {
  if (typeof value === "number") return value;
  const raw = String(value ?? "0").replace(/R\$\s?/g, "").replace(/\s/g, "");
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  const normalized = comma > -1 && dot > -1
    ? (comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""))
    : raw.replace(",", ".");
  return Number(normalized) || 0;
};

const monthBounds = (month) => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Mês inválido. Use YYYY-MM.");
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { since: `${month}-01`, until: `${month}-${String(lastDay).padStart(2, "0")}` };
};

const isInMonth = (dateValue, month) => {
  const value = String(dateValue ?? "");
  const [year, monthNumber] = month.split("-");
  if (value.startsWith(`${year}-${monthNumber}`)) return true;
  return new RegExp(`(^|/)${monthNumber}/${year}$|/${monthNumber}/${year.slice(2)}$`).test(value);
};

function campaignIdentity(rawName = "") {
  const value = normal(rawName);
  const family = value.includes("SAUDE") ? "SAUDE" : value.includes("MEDIC") ? "MEDICOS" : "OUTROS";
  const location = value
    .replace(/\b(SAUDE|MEDICOS|MEDICO|TESTE|DE|DO|DA|E|CRIATIVO|CRIATIVOS|PUBLICO|INTERESSE|ADV|COPIA|CAMPANHA|LEAD|LEADS|FORMULARIO|FORM|NOVO|NOVA)\b/g, " ")
    .replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim() || "SEM LOCALIDADE";
  return { family, location, key: `${family}|${location}`, raw: String(rawName ?? "") };
}

function statusRules() {
  const list = (name, fallback) => (process.env[name] || fallback)
    .split(",").map(normal).filter(Boolean);
  return {
    appointment: list("APPOINTMENT_STATUS_KEYWORDS", "AGUARDANDO CONFIRMACAO,REMARCACAO,REMARCOU,CHAMADA REALIZADA,ENTRADA COMPROU,DESISTIU,AGUARDANDO PAGAMENTO"),
    attendance: list("ATTENDANCE_STATUS_KEYWORDS", "CHAMADA REALIZADA,ENTRADA COMPROU,AGUARDANDO PAGAMENTO")
  };
}

const statusMatches = (status, keywords) => keywords.some((keyword) => normal(status).includes(keyword));

function serviceAccount() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada na Vercel.");
  try { return JSON.parse(json); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido."); }
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function googleAccessToken() {
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claims = base64url({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(account.private_key, "base64url")}`;
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google OAuth: ${data.error_description || data.error || response.status}`);
  return data.access_token;
}

async function googleSheetsGet(path) {
  const token = await googleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Sheets: ${data.error?.message || response.status}`);
  return data;
}

async function values(sheetId, range) {
  return googleSheetsGet(`spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`)
    .then((data) => data.values || []);
}

async function metaFetch(path, params) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN não configurado na Vercel.");
  const query = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(`${META_GRAPH}/${path}?${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(`Meta Ads: ${data.error?.message || response.status}`);
  return data;
}

async function metaCampaigns(month) {
  const accountIds = (process.env.META_AD_ACCOUNT_IDS || DEFAULT_ACCOUNTS.join(","))
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (!accountIds.length) throw new Error("META_AD_ACCOUNT_IDS não configurada na Vercel.");
  const { since, until } = monthBounds(month);
  const groups = await Promise.all(accountIds.map(async (accountId) => {
    const [campaignsResult, insightsResult] = await Promise.all([
      metaFetch(`act_${accountId}/campaigns`, { fields: "id,name,effective_status,status,created_time,start_time,stop_time", limit: "500" }),
      metaFetch(`act_${accountId}/insights`, {
        level: "campaign", time_range: JSON.stringify({ since, until }),
        fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type", limit: "500"
      })
    ]);
    const insightByCampaign = new Map((insightsResult.data || []).map((row) => [row.campaign_id, row]));
    return (campaignsResult.data || []).map((campaign) => {
      const insight = insightByCampaign.get(campaign.id) || {};
      const actions = insight.actions || [];
      const officialLead = actions.find((item) => item.action_type === "lead");
      const leads = asNumber(officialLead?.value);
      return {
        id: campaign.id, accountId, name: campaign.name, status: campaign.effective_status || campaign.status,
        active: campaign.effective_status === "ACTIVE", spend: asNumber(insight.spend),
        impressions: asNumber(insight.impressions), reach: asNumber(insight.reach), linkClicks: asNumber(insight.inline_link_clicks || insight.clicks), leads,
        ...campaignIdentity(campaign.name)
      };
    });
  }));
  return groups.flat().filter((campaign) => campaign.active || campaign.spend > 0);
}

async function metaLiveDashboard(month) {
  const meta = await metaCampaigns(month);
  const rows = mergeData(meta, [], []).map((row) => ({
    ...row, appointments: null, attendances: null, sales: null, revenue: null,
    cpa: null, leadToAttendanceRate: null, roas: null
  }));
  const summary = totals(rows);
  summary.appointments = null;
  summary.attendances = null;
  summary.sales = null;
  summary.revenue = null;
  return {
    month, mode: "meta-live", generatedAt: new Date().toISOString(), totals: summary, rows,
    sources: { metaAccounts: (process.env.META_AD_ACCOUNT_IDS || "").split(",").filter(Boolean), salesSheet: null, appointmentSheet: null }
  };
}

async function salesRows(month) {
  const sheetId = process.env.SALES_SHEET_ID;
  if (!sheetId) throw new Error("SALES_SHEET_ID não configurada na Vercel.");
  const rows = await values(sheetId, "'LEADS VENDAS'!A1:H5000");
  return rows.slice(1).filter((row) => isInMonth(row[1] || row[0], month)).map((row) => ({
    date: row[1], name: row[2], phone: row[3], profession: row[4], campaign: row[5], value: asNumber(row[6]),
    ...campaignIdentity(row[5])
  }));
}

function appointmentSheetId(month) {
  const key = `APPOINTMENT_SHEET_ID_${month.replace("-", "_")}`;
  return process.env[key] || process.env.APPOINTMENT_SHEET_ID || "";
}

async function appointmentRows(month) {
  const sheetId = appointmentSheetId(month);
  if (!sheetId) throw new Error(`Não existe planilha de agendamento configurada para ${month}.`);
  const metadata = await googleSheetsGet(`spreadsheets/${sheetId}?fields=sheets.properties`);
  const tabs = metadata.sheets.map((sheet) => sheet.properties.title).filter((title) => /^\d{2}\/\d{2}$/.test(title));
  const batches = await Promise.all(tabs.map((tab) => values(sheetId, `'${tab}'!A5:R1000`)));
  const rules = statusRules();
  return batches.flatMap((rows, index) => rows.slice(1).filter((row) => row[2] && row[6]).map((row) => {
    const status = row[9] || "";
    const identity = campaignIdentity(row[6]);
    const leadKey = normal(row[3] || row[2]) || `${identity.key}|${normal(row[2])}`;
    return {
      day: tabs[index], sdr: row[1], name: row[2], phone: row[3], profession: row[4], segment: row[5], campaign: row[6], status,
      value: asNumber(row[17]), leadKey, appointment: statusMatches(status, rules.appointment), attendance: statusMatches(status, rules.attendance), ...identity
    };
  }));
}

function emptyRecord(key, family, location) {
  return { key, family, location, meta: [], sales: [], appointments: [], attendances: [] };
}

function mergeData(meta, sales, appointments) {
  const data = new Map();
  const upsert = (entry) => {
    if (!data.has(entry.key)) data.set(entry.key, emptyRecord(entry.key, entry.family, entry.location));
    return data.get(entry.key);
  };
  meta.forEach((entry) => upsert(entry).meta.push(entry));
  sales.forEach((entry) => upsert(entry).sales.push(entry));
  const seenAppointments = new Set();
  const seenAttendances = new Set();
  appointments.forEach((entry) => {
    const target = upsert(entry);
    const dedupeKey = `${entry.key}|${entry.leadKey}`;
    if (entry.appointment && !seenAppointments.has(dedupeKey)) { target.appointments.push(entry); seenAppointments.add(dedupeKey); }
    if (entry.attendance && !seenAttendances.has(dedupeKey)) { target.attendances.push(entry); seenAttendances.add(dedupeKey); }
  });
  return [...data.values()].map((entry) => {
    const metrics = entry.meta.reduce((total, campaign) => ({
      spend: total.spend + campaign.spend, impressions: total.impressions + campaign.impressions, reach: total.reach + campaign.reach,
      linkClicks: total.linkClicks + campaign.linkClicks, leads: total.leads + campaign.leads
    }), { spend: 0, impressions: 0, reach: 0, linkClicks: 0, leads: 0 });
    const revenue = entry.sales.reduce((total, sale) => total + sale.value, 0);
    return {
      key: entry.key, family: entry.family, location: entry.location,
      campaignNames: [...new Set(entry.meta.map((campaign) => campaign.name))], accounts: [...new Set(entry.meta.map((campaign) => campaign.accountId))],
      active: entry.meta.some((campaign) => campaign.active), ...metrics, sales: entry.sales.length, revenue,
      appointments: entry.appointments.length, attendances: entry.attendances.length,
      cpl: metrics.leads ? metrics.spend / metrics.leads : null, cpc: metrics.linkClicks ? metrics.spend / metrics.linkClicks : null,
      ctr: metrics.impressions ? (metrics.linkClicks / metrics.impressions) * 100 : null, cpm: metrics.impressions ? (metrics.spend / metrics.impressions) * 1000 : null,
      leadRate: metrics.linkClicks ? (metrics.leads / metrics.linkClicks) * 100 : null,
      cpa: entry.appointments.length ? metrics.spend / entry.appointments.length : null,
      leadToAttendanceRate: metrics.leads ? (entry.attendances.length / metrics.leads) * 100 : null, roas: metrics.spend ? revenue / metrics.spend : null
    };
  }).sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
}

function totals(rows) {
  return rows.reduce((result, row) => ({
    spend: result.spend + row.spend, leads: result.leads + row.leads, sales: result.sales + row.sales, revenue: result.revenue + row.revenue,
    linkClicks: result.linkClicks + (row.linkClicks || 0), impressions: result.impressions + (row.impressions || 0),
    appointments: result.appointments + row.appointments, attendances: result.attendances + row.attendances
  }), { spend: 0, leads: 0, sales: 0, revenue: 0, linkClicks: 0, impressions: 0, appointments: 0, attendances: 0 });
}

function snapshotDashboard(month) {
  if (process.env.DASHBOARD_MODE !== "snapshot") return null;
  const monthlySnapshot = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? process.env[`DASHBOARD_SNAPSHOT_${month.replace("-", "_")}`]
    : undefined;
  const source = monthlySnapshot || process.env.DASHBOARD_SNAPSHOT;
  if (!source && Object.hasOwn(appointmentHistory, month)) return historicalDashboard(month);
  if (!source) throw new Error("DASHBOARD_SNAPSHOT não configurada na Vercel.");
  let snapshot;
  try { snapshot = JSON.parse(source); } catch { throw new Error("DASHBOARD_SNAPSHOT não é um JSON válido."); }
  if (snapshot.month !== month && !monthlySnapshot && Object.hasOwn(appointmentHistory, month)) {
    return historicalDashboard(month);
  }
  if (snapshot.month !== month) throw new Error(`O snapshot disponível é para ${snapshot.month}.`);
  return { ...snapshot, mode: "snapshot", generatedAt: snapshot.snapshotAt || new Date().toISOString() };
}

function historicalDashboard(month) {
  const rows = appointmentHistory[month].map(([family, location, appointments, attendances]) => ({
    family, location, appointments, attendances, active: null, campaignNames: [],
    spend: null, leads: null, cpl: null, linkClicks: null, cpc: null, ctr: null,
    cpm: null, leadRate: null, sales: null, revenue: null, roas: null
  }));
  const { appointments, attendances } = totals(rows);
  return {
    month, mode: "historical", rows,
    totals: { appointments, attendances, spend: null, leads: null, sales: null, revenue: null }
  };
}

function demoDashboard(month) {
  const rows = [
    { family: "MEDICOS", location: "CURITIBA", active: true, spend: 2400, leads: 142, appointments: 19, attendances: 10, sales: 3, revenue: 8400, campaignNames: ["MÉDICOS CURITIBA · DEMO"], accounts: ["CA01"], impressions: 58500, reach: 28600, linkClicks: 510 },
    { family: "MEDICOS", location: "VITORIA", active: true, spend: 1980, leads: 107, appointments: 14, attendances: 7, sales: 2, revenue: 5600, campaignNames: ["MÉDICOS VITÓRIA · DEMO"], accounts: ["CA01"], impressions: 46100, reach: 21500, linkClicks: 420 },
    { family: "SAUDE", location: "SALVADOR", active: true, spend: 3150, leads: 226, appointments: 31, attendances: 16, sales: 5, revenue: 13750, campaignNames: ["SAÚDE SALVADOR · DEMO"], accounts: ["CA01"], impressions: 98000, reach: 59200, linkClicks: 980 },
    { family: "MEDICOS", location: "CAPITAIS", active: true, spend: 1750, leads: 86, appointments: 12, attendances: 6, sales: 2, revenue: 4900, campaignNames: ["MÉDICOS CAPITAIS · DEMO"], accounts: ["CA02"], impressions: 40700, reach: 24400, linkClicks: 365 },
    { family: "SAUDE", location: "VILA VELHA", active: true, spend: 860, leads: 63, appointments: 9, attendances: 4, sales: 1, revenue: 2450, campaignNames: ["SAÚDE VILA VELHA · DEMO"], accounts: ["CA01"], impressions: 25400, reach: 14100, linkClicks: 210 }
  ].map((row) => ({
    ...row, key: `${row.family}|${row.location}`, cpl: row.spend / row.leads, cpc: row.spend / row.linkClicks,
    ctr: (row.linkClicks / row.impressions) * 100, cpm: (row.spend / row.impressions) * 1000, leadRate: (row.leads / row.linkClicks) * 100,
    cpa: row.spend / row.appointments, leadToAttendanceRate: (row.attendances / row.leads) * 100, roas: row.revenue ? row.revenue / row.spend : 0
  }));
  return { month, mode: "demo", generatedAt: new Date().toISOString(), totals: totals(rows), rows,
    sources: { metaAccounts: ["CA01", "CA02"], salesSheet: "Demonstração", appointmentSheet: "Demonstração" } };
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Método não permitido." });
  const month = String(request.query.month || new Date().toISOString().slice(0, 7));
  try {
    const snapshot = snapshotDashboard(month);
    if (snapshot) return response.status(200).json(snapshot);
    if (process.env.DASHBOARD_MODE === "meta-live") return response.status(200).json(await metaLiveDashboard(month));
    if (process.env.DASHBOARD_MODE === "demo") return response.status(200).json(demoDashboard(month));
    const [meta, sales, appointments] = await Promise.all([metaCampaigns(month), salesRows(month), appointmentRows(month)]);
    const rows = mergeData(meta, sales, appointments);
    return response.status(200).json({ month, generatedAt: new Date().toISOString(), totals: totals(rows), rows,
      sources: { metaAccounts: (process.env.META_AD_ACCOUNT_IDS || "").split(",").filter(Boolean), salesSheet: process.env.SALES_SHEET_ID, appointmentSheet: appointmentSheetId(month) } });
  } catch (error) {
    return response.status(500).json({ error: error.message, setup: true });
  }
}
