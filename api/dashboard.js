import crypto from "node:crypto";

const META_GRAPH = "https://graph.facebook.com/v21.0";
const DEFAULT_ACCOUNTS = [];

const normal = (value = "") => String(value)
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const asNumber = (value) => {
  if (typeof value === "number") return value;
  return Number(String(value ?? "0").replace(/R\$|\./g, "").replace(",", ".")) || 0;
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
      const leads = actions.filter((item) => /lead/i.test(item.action_type)).reduce((sum, item) => sum + asNumber(item.value), 0);
      return {
        id: campaign.id, accountId, name: campaign.name, status: campaign.effective_status || campaign.status,
        active: campaign.effective_status === "ACTIVE", spend: asNumber(insight.spend),
        impressions: asNumber(insight.impressions), reach: asNumber(insight.reach), clicks: asNumber(insight.inline_link_clicks || insight.clicks), leads,
        ...campaignIdentity(campaign.name)
      };
    });
  }));
  return groups.flat().filter((campaign) => campaign.active || campaign.spend > 0);
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
      clicks: total.clicks + campaign.clicks, leads: total.leads + campaign.leads
    }), { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 });
    const revenue = entry.sales.reduce((total, sale) => total + sale.value, 0);
    return {
      key: entry.key, family: entry.family, location: entry.location,
      campaignNames: [...new Set(entry.meta.map((campaign) => campaign.name))], accounts: [...new Set(entry.meta.map((campaign) => campaign.accountId))],
      active: entry.meta.some((campaign) => campaign.active), ...metrics, sales: entry.sales.length, revenue,
      appointments: entry.appointments.length, attendances: entry.attendances.length,
      cpl: metrics.leads ? metrics.spend / metrics.leads : null, cpa: entry.appointments.length ? metrics.spend / entry.appointments.length : null,
      roas: metrics.spend ? revenue / metrics.spend : null
    };
  }).sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
}

function totals(rows) {
  return rows.reduce((result, row) => ({
    spend: result.spend + row.spend, leads: result.leads + row.leads, sales: result.sales + row.sales, revenue: result.revenue + row.revenue,
    appointments: result.appointments + row.appointments, attendances: result.attendances + row.attendances
  }), { spend: 0, leads: 0, sales: 0, revenue: 0, appointments: 0, attendances: 0 });
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Método não permitido." });
  const month = String(request.query.month || new Date().toISOString().slice(0, 7));
  try {
    const [meta, sales, appointments] = await Promise.all([metaCampaigns(month), salesRows(month), appointmentRows(month)]);
    const rows = mergeData(meta, sales, appointments);
    return response.status(200).json({ month, generatedAt: new Date().toISOString(), totals: totals(rows), rows,
      sources: { metaAccounts: (process.env.META_AD_ACCOUNT_IDS || "").split(",").filter(Boolean), salesSheet: process.env.SALES_SHEET_ID, appointmentSheet: appointmentSheetId(month) } });
  } catch (error) {
    return response.status(500).json({ error: error.message, setup: true });
  }
}
