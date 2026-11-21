const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatNumber = new Intl.NumberFormat("pt-BR");
const month = document.querySelector("#month");
const search = document.querySelector("#search");
const refresh = document.querySelector("#refresh");
const notice = document.querySelector("#notice");
const cards = document.querySelector("#cards");
const sortField = document.querySelector("#sort-field");
const sortDirection = document.querySelector("#sort-direction");
let descending = true;
const tableRows = document.querySelector("#rows");
const rowCount = document.querySelector("#row-count");
const updated = document.querySelector("#updated");
let dashboard;

month.value = new Date().toISOString().slice(0, 7);
const amount = (value) => formatCurrency.format(value || 0);
const count = (value) => formatNumber.format(value || 0);
const decimal = (value, digits = 2) => value === null || value === undefined ? "—" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value) => value === null || value === undefined ? "—" : `${decimal(value)}%`;
const escape = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);

function renderCards(totals) {
  const roas = totals.spend ? totals.revenue / totals.spend : null;
  const leadToAttendance = totals.leads ? (totals.attendances / totals.leads) * 100 : null;
  const cardData = [["Investimento", amount(totals.spend), "Meta Ads"], ["Leads Meta", count(totals.leads), totals.leads ? `CPL ${amount(totals.spend / totals.leads)}` : "Sem leads"], ["Agendamentos", count(totals.appointments), "Leads únicos"], ["Atendimentos", count(totals.attendances), `Lead/atend. ${percent(leadToAttendance)}`], ["Vendas", count(totals.sales), "Base comercial"], ["Faturamento", amount(totals.revenue), roas === null ? "ROAS —" : `ROAS ${roas.toFixed(2)}x`]];
  cards.innerHTML = cardData.map(([label, value, detail]) => `<article class="card"><p>${label}</p><strong>${value}</strong><small>${detail}</small></article>`).join("");
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
  rowCount.textContent = `${rows.length} resultado${rows.length === 1 ? "" : "s"}`;
  tableRows.innerHTML = rows.length ? rows.map((row) => `<tr><td><div class="campaign"><strong>${escape(row.family)} · ${escape(row.location)}</strong><span>${escape(row.campaignNames.join(" · ") || "Sem campanha Meta no período")}</span></div></td><td><span class="badge ${row.active ? "active" : "paused"}">${row.active ? "Ativa" : "Rodou no mês"}</span></td><td>${amount(row.spend)}</td><td>${count(row.leads)}</td><td>${amount(row.cpl)}</td><td>${count(row.linkClicks)}</td><td>${amount(row.cpc)}</td><td>${percent(row.ctr)}</td><td>${amount(row.cpm)}</td><td>${percent(row.leadRate)}</td><td>${count(row.appointments)}</td><td>${count(row.attendances)}</td><td>${percent(row.leadToAttendanceRate)}</td><td>${count(row.sales)}</td><td>${amount(row.revenue)}</td><td>${row.roas === null ? "—" : `${row.roas.toFixed(2)}x`}</td></tr>`).join("") : `<tr><td colspan="16">Nenhum resultado para esta busca.</td></tr>`;
}

async function load() {
  notice.className = "notice loading";
  notice.textContent = "Atualizando Meta Ads e planilhas...";
  refresh.disabled = true;
  try {
    const response = await fetch(`/api/dashboard?month=${month.value}`);
    dashboard = await response.json();
    if (!response.ok) throw new Error(dashboard.error || "Não foi possível carregar os dados.");
    renderCards(dashboard.totals);
    renderRows();
    notice.className = "notice";
    notice.textContent = dashboard.mode === "demo"
      ? "Modo demonstração: métricas simuladas para validar a estrutura."
      : dashboard.mode === "snapshot"
        ? `Snapshot fechado: ${dashboard.scope}. Meta, vendas, agendamentos e atendimentos consolidados.`
        : `Dados consolidados para ${month.value}. CA01 e CA02 estão incluídas.`;
    updated.textContent = `Última atualização: ${new Date(dashboard.generatedAt).toLocaleString("pt-BR")}.`;
  } catch (error) {
    dashboard = undefined;
    cards.innerHTML = ""; tableRows.innerHTML = ""; rowCount.textContent = "";
    notice.className = "notice error";
    notice.textContent = `${error.message} Configure as variáveis da Vercel conforme o README e atualize novamente.`;
    updated.textContent = "";
  } finally { refresh.disabled = false; }
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
month.addEventListener("change", load);
refresh.addEventListener("click", load);
load();
