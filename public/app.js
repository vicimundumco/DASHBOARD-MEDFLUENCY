import { updateTrend } from "./trend.js";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatNumber = new Intl.NumberFormat("pt-BR");
const timeline = document.querySelector("#timeline-months");
const timelineYear = document.querySelector("#timeline-year");
const selectedPeriod = document.querySelector("#selected-period");
const previousYear = document.querySelector("#previous-year");
const nextYear = document.querySelector("#next-year");
const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long" });
const today = new Date();
let year = today.getFullYear();
let selectedMonth = monthKey(year, today.getMonth());
let currentRequest;
const search = document.querySelector("#search");
const refresh = document.querySelector("#refresh");
const notice = document.querySelector("#notice");
const cards = document.querySelector("#cards");
const dailyMetric = document.querySelector("#daily-metric");
const dailyPeriod = document.querySelector("#daily-period");
const dailyPlot = document.querySelector("#daily-plot");
const dailyRows = document.querySelector("#daily-rows");
const dailyDate = document.querySelector("#daily-date");
const dailyFamily = document.querySelector("#daily-family");
const dailySearch = document.querySelector("#daily-search");
const dailyDetailPeriod = document.querySelector("#daily-detail-period");
const dailyDetailRows = document.querySelector("#daily-detail-rows");
let selectedDailyDate = "";
const sortField = document.querySelector("#sort-field");
const sortDirection = document.querySelector("#sort-direction");
let descending = true;
const exportCsv = document.querySelector("#export-csv");
const funnelTable = document.querySelector("#funnel-table");
const shareMetric = document.querySelector("#share-metric");
const sharePeriod = document.querySelector("#share-period");
const shareChart = document.querySelector("#share-chart");
const shareTotal = document.querySelector("#share-total");
const shareLegend = document.querySelector("#share-legend");
const shareColors = ["#006d70", "#00b9ba", "#f5a000", "#ff7711", "#285a86", "#aab8bc"];
let preferredShareMetric = "leads";
const summaryPeriod = document.querySelector("#campaign-summary-period");
const summaryMetric = document.querySelector("#campaign-summary-metric");
const summaryRows = document.querySelector("#campaign-summary-rows");
const tableRows = document.querySelector("#rows");
const rowCount = document.querySelector("#row-count");
const updated = document.querySelector("#updated");
let dashboard;

function monthKey(year, index) {
  return `${year}-${String(index + 1).padStart(2, "0")}`;
}

function renderTimeline() {
  timelineYear.textContent = year;
  previousYear.disabled = year <= 1000;
  nextYear.disabled = year >= 9999;
  timeline.replaceChildren(...Array.from({ length: 12 }, (_, index) => {
    const button = document.createElement("button");
    const label = monthLabel.format(new Date(year, index, 1));
    const value = monthKey(year, index);
    button.type = "button";
    button.value = value;
    button.textContent = label.slice(0, 3);
    button.setAttribute("aria-label", `${label} de ${year}`);
    button.setAttribute("aria-pressed", String(value === selectedMonth));
    return button;
  }));
}

function selectPeriod() {
  const [year, month] = selectedMonth.split("-").map(Number);
  selectedPeriod.textContent = `${monthLabel.format(new Date(year, month - 1, 1))} de ${year}`;
  for (const button of timeline.children) {
    button.setAttribute("aria-pressed", String(button.value === selectedMonth));
  }
}

const amount = (value) => (value == null ? "—" : formatCurrency.format(value));
const count = (value) => (value == null ? "—" : formatNumber.format(value));
const decimal = (value, digits = 2) => value === null || value === undefined ? "—" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value) => value === null || value === undefined ? "—" : `${decimal(value)}%`;
const escape = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);

const ratioPercent = (numerator, denominator) => numerator == null || denominator == null || !denominator ? null : (numerator / denominator) * 100;


function sumMetric(rows, metric) {
  const values = rows.map((row) => row[metric]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function totalsForRows(rows) {
  const totals = {
    spend: sumMetric(rows, "spend"),
    leads: sumMetric(rows, "leads"),
    linkClicks: sumMetric(rows, "linkClicks"),
    impressions: sumMetric(rows, "impressions"),
    appointments: sumMetric(rows, "appointments"),
    attendances: sumMetric(rows, "attendances"),
    sales: sumMetric(rows, "sales"),
    revenue: sumMetric(rows, "revenue")
  };
  return {
    ...totals,
    cpl: totals.leads ? totals.spend / totals.leads : null,
    cpc: totals.linkClicks ? totals.spend / totals.linkClicks : null,
    ctr: ratioPercent(totals.linkClicks, totals.impressions),
    cpm: totals.impressions ? (totals.spend / totals.impressions) * 1000 : null,
    leadRate: ratioPercent(totals.leads, totals.linkClicks),
    leadToAttendanceRate: ratioPercent(totals.attendances, totals.leads),
    roas: totals.spend ? totals.revenue / totals.spend : null
  };
}

function totalIdentity(rows, scope) {
  return `<div class="campaign"><strong>Total ${scope}</strong><span>${count(rows.length)} localidade${rows.length === 1 ? "" : "s"} no filtro atual</span></div>`;
}

function monthlyTotalRow(rows) {
  const totals = totalsForRows(rows);
  return `<tr class="total-row"><td>${totalIdentity(rows, "do período")}</td><td>—</td><td>${amount(totals.spend)}</td><td>${count(totals.leads)}</td><td>${percent(totals.leads == null ? null : 100)}</td><td>${amount(totals.cpl)}</td><td>${count(totals.linkClicks)}</td><td>${amount(totals.cpc)}</td><td>${percent(totals.ctr)}</td><td>${amount(totals.cpm)}</td><td>${percent(totals.leadRate)}</td><td>${count(totals.appointments)}</td><td>${count(totals.attendances)}</td><td>${percent(totals.leadToAttendanceRate)}</td><td>${count(totals.sales)}</td><td>${amount(totals.revenue)}</td><td>${totals.roas == null ? "—" : `${totals.roas.toFixed(2)}x`}</td></tr>`;
}

function dailyTotalRow(rows) {
  const totals = totalsForRows(rows);
  return `<tr class="total-row"><td>${totalIdentity(rows, "do dia")}</td><td>—</td><td>${amount(totals.spend)}</td><td>${count(totals.leads)}</td><td>${amount(totals.cpl)}</td><td>${count(totals.linkClicks)}</td><td>${amount(totals.cpc)}</td><td>${percent(totals.ctr)}</td><td>${amount(totals.cpm)}</td><td>${percent(totals.leadRate)}</td><td>${count(totals.appointments)}</td><td>${count(totals.attendances)}</td><td>${count(totals.sales)}</td><td>${amount(totals.revenue)}</td><td>${totals.roas == null ? "—" : `${totals.roas.toFixed(2)}x`}</td></tr>`;
}
function renderCards(totals) {
  const roas = totals.spend ? totals.revenue / totals.spend : null;
  const leadToAttendance = ratioPercent(totals.attendances, totals.leads);
  const cardData = [["Investimento", amount(totals.spend), "Meta Ads"], ["Leads Meta", count(totals.leads), totals.leads ? `CPL ${amount(totals.spend / totals.leads)}` : totals.leads === null ? "Dados indisponíveis" : "Sem leads"], ["Agendamentos", count(totals.appointments), "Leads únicos"], ["Atendimentos", count(totals.attendances), `Atendimentos/Leads ${percent(leadToAttendance)}`], ["Vendas", count(totals.sales), "Base comercial"], ["Faturamento", amount(totals.revenue), roas === null ? "ROAS —" : `ROAS ${roas.toFixed(2)}x`]];
  cards.innerHTML = cardData.map(([label, value, detail]) => `<article class="card"><p>${label}</p><strong>${value}</strong><small>${detail}</small></article>`).join("");
}

function dailyValue(row, metric) {
  return row[metric] ?? null;
}

function dailyLabel(metric, value) {
  if (metric === "spend" || metric === "cpl" || metric === "cpc" || metric === "cpm") return amount(value);
  if (metric === "ctr" || metric === "leadRate") return percent(value);
  return count(value);
}

function renderDailyDetail() {
  const date = selectedDailyDate;
  const family = dailyFamily.value;
  const term = normalSearch(dailySearch.value);
  const rows = (dashboard?.dailyDetails || []).filter((row) => row.date === date)
    .filter((row) => !family || row.family === family)
    .filter((row) => normalSearch([row.family, row.location, ...row.campaignNames].join(" ")).includes(term))
    .sort((a, b) => b.spend - a.spend);
  dailyDetailPeriod.textContent = date
    ? `${new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR")} · ${rows.length} localidade${rows.length === 1 ? "" : "s"} com entrega`
    : "Selecione um dia no gráfico acima.";
  dailyDetailRows.innerHTML = rows.length ? `${rows.map((row) => `<tr><td><div class="campaign"><strong>${escape(row.family)} · ${escape(row.location)}</strong><span>${escape(row.campaignNames.join(" · "))}</span></div></td><td><span class="badge active">Rodou no dia</span></td><td>${amount(row.spend)}</td><td>${count(row.leads)}</td><td>${amount(row.cpl)}</td><td>${count(row.linkClicks)}</td><td>${amount(row.cpc)}</td><td>${percent(row.ctr)}</td><td>${amount(row.cpm)}</td><td>${percent(row.leadRate)}</td><td>${count(row.appointments)}</td><td>${count(row.attendances)}</td><td>${count(row.sales)}</td><td>${amount(row.revenue)}</td><td>${row.roas == null ? "—" : `${row.roas.toFixed(2)}x`}</td></tr>`).join("")}${dailyTotalRow(rows)}`
    : '<tr><td colspan="15">Nenhuma localidade com entrega para este filtro.</td></tr>';
}

function normalSearch(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function renderDaily() {
  const days = dashboard?.daily || [];
  if (!days.some((row) => row.date === selectedDailyDate)) selectedDailyDate = days.at(-1)?.date || "";
  dailyDate.min = days[0]?.date || "";
  dailyDate.max = days.at(-1)?.date || "";
  dailyDate.value = selectedDailyDate;
  dailyPeriod.textContent = days.length
    ? `${selectedPeriod.textContent} · Selecione uma barra para abrir as localidades do dia`
    : `${selectedPeriod.textContent} · Dados diários indisponíveis para este mês`;
  dailyRows.innerHTML = days.length ? days.map((row) => {
    const date = new Date(`${row.date}T12:00:00`).toLocaleDateString("pt-BR");
    return `<tr><td>${date}</td><td>${amount(row.spend)}</td><td>${count(row.leads)}</td><td>${amount(row.cpl)}</td><td>${count(row.linkClicks)}</td><td>${amount(row.cpc)}</td><td>${percent(row.ctr)}</td><td>${amount(row.cpm)}</td><td>${percent(row.leadRate)}</td></tr>`;
  }).join("") : '<tr><td colspan="9">Sem dados diários para este mês.</td></tr>';

  for (const option of dailyMetric.options) option.disabled = !days.some((row) => Number.isFinite(dailyValue(row, option.value)));
  if (dailyMetric.selectedOptions[0]?.disabled) dailyMetric.value = [...dailyMetric.options].find((option) => !option.disabled)?.value || "spend";
  const metric = dailyMetric.value;
  const maximum = Math.max(...days.map((row) => Number(dailyValue(row, metric)) || 0), 0);
  dailyPlot.replaceChildren();
  if (!days.length || maximum === 0) {
    dailyPlot.textContent = "Sem dados para exibir.";
    renderDailyDetail();
    return;
  }
  days.forEach((row) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "daily-bar";
    item.dataset.date = row.date;
    item.setAttribute("aria-pressed", String(row.date === selectedDailyDate));
    item.title = `${new Date(`${row.date}T12:00:00`).toLocaleDateString("pt-BR")}: ${dailyLabel(metric, dailyValue(row, metric))}`;
    const bar = document.createElement("span");
    bar.style.height = `${Math.max(4, (Number(dailyValue(row, metric)) / maximum) * 100)}%`;
    const label = document.createElement("small");
    label.textContent = row.date.slice(-2);
    item.append(bar, label);
    dailyPlot.append(item);
  });
  renderDailyDetail();
}

function renderShare(message) {
  shareChart.hidden = true;
  shareLegend.replaceChildren();
  shareMetric.disabled = Boolean(message);
  if (message) {
    sharePeriod.textContent = message;
    return;
  }

  for (const option of shareMetric.options) {
    option.disabled = !Number.isFinite(dashboard.totals[option.value]);
  }
  const preferred = [...shareMetric.options].find((option) => option.value === preferredShareMetric && !option.disabled);
  shareMetric.value = preferred?.value || [...shareMetric.options].find((option) => !option.disabled)?.value || "";
  const metric = shareMetric.value;
  const total = dashboard.totals[metric];
  if (!(total > 0)) {
    sharePeriod.textContent = `${selectedPeriod.textContent} · Sem dados para este indicador`;
    return;
  }

  const groups = dashboard.rows.filter((row) => row[metric] > 0)
    .sort((a, b) => b[metric] - a[metric]).slice(0, 5)
    .map((row) => [row.family === "SEM CAMPANHA" ? "Sem campanha" : `${row.family} · ${row.location}`, row[metric]]);
  const remainder = total - groups.reduce((sum, [, value]) => sum + value, 0);
  if (remainder > 0) groups.push(["Demais campanhas", remainder]);
  let start = 0;
  const slices = groups.map(([label, value], index) => {
    const color = shareColors[index];
    const percentage = ratioPercent(value, total);
    const item = document.createElement("li");
    item.style.setProperty("--share-color", color);
    item.innerHTML = `<span>${escape(label)}</span><strong>${percent(percentage)}</strong>`;
    item.title = `${label}: ${count(value)} de ${count(total)}`;
    shareLegend.append(item);
    const stop = Math.min(100, start + percentage);
    const slice = `${color} ${start}% ${stop}%`;
    start = stop;
    return slice;
  });
  sharePeriod.textContent = selectedPeriod.textContent;
  shareChart.style.background = `conic-gradient(${slices.join(", ")})`;
  shareTotal.textContent = count(total);
  shareChart.hidden = false;
}

shareMetric.addEventListener("change", () => {
  preferredShareMetric = shareMetric.value;
  renderShare();
});

function renderCampaignSummary({ rows, totals }) {
  const metric = totals.leads == null ? "appointments" : "leads";
  summaryMetric.textContent = metric === "leads" ? "Leads" : "Agend.";
  const campaigns = rows
    .filter((row) => row.family !== "SEM CAMPANHA" && Number.isFinite(row[metric]))
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, 5);
  summaryRows.innerHTML = campaigns.length
    ? campaigns.map((row) => `<tr><td><strong>${escape(row.family)}</strong><span>${escape(row.location)}</span></td><td>${count(row[metric])}</td></tr>`).join("")
    : '<tr><td colspan="2">Sem campanhas no período.</td></tr>';
}

function renderRows() {
  const term = search.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const rows = dashboard.rows.filter((row) => [row.family, row.location, ...row.campaignNames].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes(term));
  const field = sortField.value;
  if (field) {
    rows.sort((first, second) => {
      const a = first[field];
      const b = second[field];
      if (a == null) return b == null ? 0 : 1;
      if (b == null) return -1;
      const comparison = field === "family"
        ? a.localeCompare(b, "pt-BR") || first.location.localeCompare(second.location, "pt-BR")
        : Number(a) - Number(b);
      return descending ? -comparison : comparison;
    });
  }
  exportCsv.disabled = refresh.disabled || rows.length === 0;
  rowCount.textContent = `${rows.length} resultado${rows.length === 1 ? "" : "s"}`;
  tableRows.innerHTML = rows.length ? `${rows.map((row) => `<tr><td><div class="campaign"><strong>${escape(row.family)} · ${escape(row.location)}</strong><span>${escape(row.campaignNames.join(" · ") || (dashboard.mode === "historical" ? "" : "Sem campanha Meta no período"))}</span></div></td><td><span class="badge ${row.active ? "active" : "paused"}">${row.active == null ? "—" : row.active ? "Ativa" : "Rodou no mês"}</span></td><td>${amount(row.spend)}</td><td>${count(row.leads)}</td><td>${percent(row.leadShare)}</td><td>${amount(row.cpl)}</td><td>${count(row.linkClicks)}</td><td>${amount(row.cpc)}</td><td>${percent(row.ctr)}</td><td>${amount(row.cpm)}</td><td>${percent(row.leadRate)}</td><td>${count(row.appointments)}</td><td>${count(row.attendances)}</td><td>${percent(row.leadToAttendanceRate)}</td><td>${count(row.sales)}</td><td>${amount(row.revenue)}</td><td>${row.roas === null ? "—" : `${row.roas.toFixed(2)}x`}</td></tr>`).join("")}${monthlyTotalRow(rows)}` : `<tr><td colspan="17">Nenhum resultado para esta busca.</td></tr>`;
}

function csvCell(text) {
  // Spreadsheet applications may interpret campaign names as formulas.
  const value = /^[\s\uFEFF]*[=+@-]/.test(text) && !/^-\d+(?:[,.]\d+)*%?$/.test(text)
    ? "'" + text
    : text;
  return '"' + value.replaceAll('"', '""') + '"';
}

exportCsv.addEventListener("click", () => {
  if (exportCsv.disabled) return;

  const lines = Array.from(funnelTable.rows, (row) =>
    Array.from(row.cells, (cell) => csvCell(cell.innerText.trim())).join(";")
  );
  const file = new Blob(["\uFEFF", lines.join("\r\n"), "\r\n"], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `med-fluency-funil-${selectedMonth}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function load({ initializeTrend = false } = {}) {
  currentRequest?.abort();
  const request = new AbortController();
  currentRequest = request;
  const month = selectedMonth;
  notice.className = "notice loading";
  notice.textContent = "Atualizando Meta Ads e planilhas...";
  renderShare("Carregando participação…");
  summaryPeriod.textContent = selectedPeriod.textContent;
  summaryRows.innerHTML = '<tr><td colspan="2">Carregando dados…</td></tr>';
  refresh.disabled = true;
  exportCsv.disabled = true;
  try {
    const monthlyResponse = fetch(`/api/dashboard?month=${month}`, { signal: request.signal });
    if (initializeTrend) {
      updateTrend(month, monthlyResponse.then(async (response) => response.ok ? response.clone().json() : null));
    }
    const response = await monthlyResponse;
    const data = await response.json();
    if (request !== currentRequest) return;
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar os dados.");
    dashboard = {
      ...data,
      rows: data.rows.map((row) => ({
        ...row,
        leadToAttendanceRate: ratioPercent(row.attendances, row.leads),
        leadShare: ratioPercent(row.leads, data.totals.leads)
      }))
    };
    renderCards(dashboard.totals);
    renderDaily();
    renderCampaignSummary(dashboard);
    renderShare();
    renderRows();
    notice.className = "notice";
    notice.textContent = dashboard.mode === "demo"
      ? "Modo demonstração: métricas simuladas para validar a estrutura."
      : dashboard.mode === "historical"
        ? "Histórico de agendamentos e atendimentos. Os demais indicadores estão indisponíveis neste mês."
      : dashboard.mode === "snapshot"
        ? `Snapshot fechado: ${dashboard.scope}. Meta, vendas, agendamentos e atendimentos consolidados.`
      : dashboard.mode === "meta-live"
        ? "Meta Ads ao vivo. Vendas, faturamento, agendamentos e atendimentos serão ativados na próxima conexão."
        : `Dados consolidados para ${month}. CA01 e CA02 estão incluídas.`;
    updated.textContent = dashboard.generatedAt
      ? `Última atualização: ${new Date(dashboard.generatedAt).toLocaleString("pt-BR")}.`
      : "";
  } catch (error) {
    if (request !== currentRequest) return;
    dashboard = undefined;
    renderShare("Participação indisponível.");
    summaryRows.innerHTML = '<tr><td colspan="2">Dados indisponíveis.</td></tr>';
    cards.innerHTML = ""; tableRows.innerHTML = ""; rowCount.textContent = "";
    notice.className = "notice error";
    notice.textContent = `${error.message} Configure as variáveis da Vercel conforme o README e atualize novamente.`;
    updated.textContent = "";
  } finally {
    if (request === currentRequest) {
      refresh.disabled = false;
      exportCsv.disabled = !dashboard || tableRows.rows[0]?.cells.length !== funnelTable.tHead.rows[0].cells.length;
    }
  }
}

search.addEventListener("input", () => dashboard && renderRows());
sortField.addEventListener("change", () => {
  sortDirection.disabled = !sortField.value;
  if (dashboard) renderRows();
});
sortDirection.addEventListener("click", () => {
  descending = !descending;
  sortDirection.textContent = descending ? "Decrescente" : "Crescente";
  if (dashboard) renderRows();
});
previousYear.addEventListener("click", () => {
  year -= 1;
  renderTimeline();
});
nextYear.addEventListener("click", () => {
  year += 1;
  renderTimeline();
});
timeline.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.value === selectedMonth) return;
  selectedMonth = button.value;
  selectPeriod();
  load();
});
renderTimeline();
selectPeriod();
dailyMetric.addEventListener("change", renderDaily);
dailyPlot.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (!button) return;
  selectedDailyDate = button.dataset.date;
  renderDaily();
});
dailyDate.addEventListener("change", () => {
  selectedDailyDate = dailyDate.value;
  renderDaily();
});
dailyFamily.addEventListener("change", renderDailyDetail);
dailySearch.addEventListener("input", renderDailyDetail);
refresh.addEventListener("click", load);
load({ initializeTrend: true });
