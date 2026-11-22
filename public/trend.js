const metrics = {
  leads: ["Leads", "count"],
  spend: ["Investimento", "currency"],
  cpl: ["CPL", "currency"],
  linkClicks: ["Cliques no link", "count"],
  cpc: ["CPC", "currency"],
  cpm: ["CPM", "currency"],
  appointments: ["Agendamentos", "count"],
  attendances: ["Atendimentos", "count"],
  sales: ["Vendas", "count"],
  revenue: ["Faturamento", "currency"],
  roas: ["ROAS", "multiple"]
};

const metric = document.querySelector("#trend-metric");
const windowSelect = document.querySelector("#trend-window");
const campaigns = document.querySelector("#trend-campaigns");
const status = document.querySelector("#trend-status");
const plot = document.querySelector("#trend-plot");
const legend = document.querySelector("#trend-legend");
const values = document.querySelector("#trend-values");
const table = document.querySelector("#trend-table");
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
const colors = ["#006d70", "#00878a", "#a86400", "#c44900", "#285a86", "#76518c"];
const selected = new Set();
const cache = new Map();
let activeLoad;
let currentMonth;
let currentData;
let history = [];
let initialized = false;

for (const [key, [label]] of Object.entries(metrics)) metric.add(new Option(label, key));

export function monthRange(end, count) {
  const [year, month] = end.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const ordinal = year * 12 + month - count + index;
    return `${String(Math.floor(ordinal / 12)).padStart(4, "0")}-${String(ordinal % 12 + 1).padStart(2, "0")}`;
  }).filter((month) => month >= "1000-01");
}

const monthLabel = (month) => monthFormat.format(new Date(`${month}-01T00:00:00Z`)).replace(".", "");
const campaignName = (row) => `${row.family} · ${row.location}`;
const campaignKey = (row) => JSON.stringify([row.family, row.location]);
const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
const svg = (tag, attributes) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

export function updateTrend(month, data) {
  currentMonth = month;
  currentData = data.catch(() => null);
  loadHistory();
}

async function loadHistory() {
  activeLoad?.abort();
  const controller = new AbortController();
  activeLoad = controller;
  const end = currentMonth;
  const latest = currentData;
  const months = monthRange(end, Number(windowSelect.value));
  status.textContent = "Carregando histórico mensal…";
  plot.replaceChildren();
  legend.replaceChildren();
  campaigns.replaceChildren();
  values.hidden = true;

  const last = await latest;
  if (controller.signal.aborted) return;

  history = [];
  for (let index = 0; index < months.length; index += 3) {
    const batch = await Promise.all(months.slice(index, index + 3).map(async (month) => {
      let data = month === end ? last : cache.get(month);
      if (month !== end && !data) {
        try {
          const response = await fetch(`/api/dashboard?month=${month}`, { signal: controller.signal });
          if (response.ok) data = await response.json();
        } catch {
          // Leave unavailable months as gaps in the chart.
        }
      }
      if (Array.isArray(data?.rows)) {
        if (cache.size >= 24) cache.delete(cache.keys().next().value);
        cache.set(month, data);
        return { month, rows: new Map(data.rows.map((row) => [campaignKey(row), row])) };
      }
      if (month === end) cache.delete(month);
      return { month, rows: null };
    }));
    if (controller.signal.aborted) return;
    history.push(...batch);
  }

  const options = new Map();
  for (const period of [...history].reverse()) {
    for (const [key, row] of period.rows || []) options.set(key, campaignName(row));
  }
  if (!initialized && options.size) {
    for (const key of [...options.keys()].slice(0, 2)) selected.add(key);
    initialized = true;
  }
  for (const [key, name] of [...options].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))) {
    const label = element("label", name);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = key;
    input.checked = selected.has(key);
    label.prepend(input);
    campaigns.append(label);
  }
  render();
}

function render() {
  const [label, unit] = metrics[metric.value];
  const format = (value) => unit === "currency" ? currency.format(value)
    : unit === "multiple" ? `${number.format(value)}×` : number.format(value);
  const series = [...campaigns.querySelectorAll("input:checked")].map((input, index) => ({
    name: input.parentElement.textContent,
    color: colors[index % colors.length],
    dash: ["", "8 4", "3 4"][Math.floor(index / colors.length) % 3],
    points: history.map(({ rows }) => {
      const value = rows?.get(input.value)?.[metric.value];
      return Number.isFinite(value) ? value : null;
    })
  }));
  const available = history.filter(({ rows }) => rows).length;
  plot.replaceChildren();
  legend.replaceChildren();
  values.hidden = true;
  const points = series.flatMap((line) => line.points.filter((point) => point !== null));
  if (!available || !series.length || !points.length) {
    status.textContent = !available ? "Nenhum mês com dados neste período."
      : !series.length ? "Selecione campanhas para comparar."
      : "Sem valores para este indicador nas campanhas selecionadas.";
    return;
  }

  status.textContent = available === 1 ? "Só há dados de um mês neste período."
    : available < history.length ? `${available} de ${history.length} meses com dados.` : "";
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;
  const width = Math.max(640, history.length * 70 + 100);
  const left = 116;
  const x = (index) => left + index * (width - left - 48) / Math.max(1, history.length - 1);
  const y = (value) => 222 - (value - min) / span * 190;
  const chart = svg("svg", { viewBox: `0 0 ${width} 260`, role: "img", "aria-label": `Evolução mensal de ${label}. Valores disponíveis na tabela abaixo.` });
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = min + span * tick / 4;
    chart.append(svg("line", { x1: left, x2: width - 30, y1: y(value), y2: y(value), class: "trend-grid" }));
    const caption = svg("text", { x: left - 10, y: y(value) + 4, "text-anchor": "end" });
    caption.textContent = format(value);
    chart.append(caption);
  }
  history.forEach(({ month }, index) => {
    const caption = svg("text", { x: x(index), y: 246, "text-anchor": "middle" });
    caption.textContent = monthLabel(month);
    chart.append(caption);
  });
  for (const line of series) {
    let path = "";
    line.points.forEach((value, index) => {
      if (value === null) return;
      const command = index === 0 || line.points[index - 1] === null ? "M" : "L";
      path += `${command}${x(index)} ${y(value)} `;
    });
    chart.append(svg("path", { d: path, fill: "none", stroke: line.color, "stroke-width": 3, "stroke-dasharray": line.dash }));
    line.points.forEach((value, index) => {
      if (value === null) return;
      const dot = svg("circle", { cx: x(index), cy: y(value), r: 5, fill: line.color });
      const title = svg("title", {});
      title.textContent = `${line.name} · ${monthLabel(history[index].month)} · ${format(value)}`;
      dot.append(title);
      chart.append(dot);
    });
    const item = element("li", line.name);
    item.style.setProperty("--series-color", line.color);
    legend.append(item);
  }
  plot.append(chart);

  table.replaceChildren();
  const header = table.createTHead().insertRow();
  for (const heading of ["Mês", ...series.map((line) => line.name)]) {
    const cell = element("th", heading);
    cell.scope = "col";
    header.append(cell);
  }
  const body = table.createTBody();
  history.forEach(({ month }, index) => {
    const row = body.insertRow();
    row.insertCell().textContent = monthLabel(month);
    for (const line of series) {
      const value = line.points[index];
      row.insertCell().textContent = value === null ? "—" : format(value);
    }
  });
  values.hidden = false;
}

metric.addEventListener("change", () => {
  if (!activeLoad || campaigns.children.length) render();
});
windowSelect.addEventListener("change", loadHistory);
campaigns.addEventListener("change", ({ target }) => {
  if (target.checked) selected.add(target.value);
  else selected.delete(target.value);
  render();
});
