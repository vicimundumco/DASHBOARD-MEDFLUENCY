const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatNumber = new Intl.NumberFormat("pt-BR");
const month = document.querySelector("#month");
const search = document.querySelector("#search");
const refresh = document.querySelector("#refresh");
const notice = document.querySelector("#notice");
const cards = document.querySelector("#cards");
const tableRows = document.querySelector("#rows");
const rowCount = document.querySelector("#row-count");
const updated = document.querySelector("#updated");
let dashboard;

month.value = new Date().toISOString().slice(0, 7);
const amount = (value) => formatCurrency.format(value || 0);
const count = (value) => formatNumber.format(value || 0);
const escape = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);

function renderCards(totals) {
  const roas = totals.spend ? totals.revenue / totals.spend : null;
  const cardData = [["Investimento", amount(totals.spend), "Meta Ads"], ["Leads Meta", count(totals.leads), totals.leads ? `CPL ${amount(totals.spend / totals.leads)}` : "Sem leads"], ["Agendamentos", count(totals.appointments), "Leads únicos"], ["Atendimentos", count(totals.attendances), totals.appointments ? `${((totals.attendances / totals.appointments) * 100).toFixed(1)}% dos agendados` : "—"], ["Vendas", count(totals.sales), "Base comercial"], ["Faturamento", amount(totals.revenue), roas === null ? "ROAS —" : `ROAS ${roas.toFixed(2)}x`]];
  cards.innerHTML = cardData.map(([label, value, detail]) => `<article class="card"><p>${label}</p><strong>${value}</strong><small>${detail}</small></article>`).join("");
}

function renderRows() {
  const term = search.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const rows = dashboard.rows.filter((row) => [row.family, row.location, ...row.campaignNames].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes(term));
  rowCount.textContent = `${rows.length} resultado${rows.length === 1 ? "" : "s"}`;
  tableRows.innerHTML = rows.length ? rows.map((row) => `<tr><td><div class="campaign"><strong>${escape(row.family)} · ${escape(row.location)}</strong><span>${escape(row.campaignNames.join(" · ") || "Sem campanha Meta no período")}</span></div></td><td><span class="badge ${row.active ? "active" : "paused"}">${row.active ? "Ativa" : "Rodou no mês"}</span></td><td>${amount(row.spend)}</td><td>${count(row.leads)}</td><td>${count(row.appointments)}</td><td>${count(row.attendances)}</td><td>${count(row.sales)}</td><td>${amount(row.revenue)}</td><td>${row.roas === null ? "—" : `${row.roas.toFixed(2)}x`}</td></tr>`).join("") : `<tr><td colspan="9">Nenhum resultado para esta busca.</td></tr>`;
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
    notice.textContent = `Dados consolidados para ${month.value}. CA01 e CA02 estão incluídas.`;
    updated.textContent = `Última atualização: ${new Date(dashboard.generatedAt).toLocaleString("pt-BR")}.`;
  } catch (error) {
    cards.innerHTML = ""; tableRows.innerHTML = "";
    notice.className = "notice error";
    notice.textContent = `${error.message} Configure as variáveis da Vercel conforme o README e atualize novamente.`;
    updated.textContent = "";
  } finally { refresh.disabled = false; }
}

search.addEventListener("input", () => dashboard && renderRows());
month.addEventListener("change", load);
refresh.addEventListener("click", load);
load();
