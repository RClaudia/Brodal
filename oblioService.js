function proxyInvoicesUrl(proxyUrl, query) {
  const baseUrl = String(proxyUrl ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Configurează URL-ul proxy Oblio.");
  return `${baseUrl}/invoices?${query}`;
}

async function requestInvoices(proxyUrl, query) {
  const response = await fetch(proxyInvoicesUrl(proxyUrl, query), {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Proxy-ul Oblio a răspuns cu eroarea HTTP ${response.status}.`);
  }
  const body = await response.json();
  const invoices = Array.isArray(body) ? body : body?.invoices ?? body?.data;
  if (!Array.isArray(invoices)) {
    throw new Error("Răspunsul proxy-ului Oblio trebuie să conțină o listă de facturi.");
  }
  return invoices.map(normalizeInvoice);
}

function normalizeInvoiceDate(value) {
  const date = String(value ?? "");
  const isoDate = date.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const romanianDate = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (romanianDate) return `${romanianDate[3]}-${romanianDate[2]}-${romanianDate[1]}`;
  return date;
}

function normalizeInvoice(invoice) {
  const client = typeof invoice.client === "string"
    ? invoice.client
    : invoice.client?.name ?? invoice.clientName ?? invoice.customerName ?? "";
  const number = invoice.number ?? invoice.invoiceNumber ?? invoice.seriesNumber
    ?? [invoice.seriesName, invoice.number].filter(Boolean).join(" ");
  const total = Number(invoice.total ?? invoice.totalAmount ?? invoice.amount);
  const status = String(invoice.status ?? (invoice.paid ? "Achitată" : "Necunoscută"));
  const normalizedStatus = status.trim().toLocaleLowerCase();
  const id = invoice.id ?? invoice.invoiceId ?? number;
  if (!number || !id || !Number.isFinite(total) || total < 0) {
    throw new Error("O factură primită de la proxy nu conține identificator, număr sau total valid.");
  }
  return {
    id: String(id),
    number: String(number),
    date: normalizeInvoiceDate(invoice.date ?? invoice.issueDate ?? invoice.invoiceDate),
    client: String(client),
    total,
    status,
    paid: invoice.paid === true
      || normalizedStatus === "paid"
      || normalizedStatus.startsWith("paid ")
      || normalizedStatus.startsWith("achitat")
  };
}

export function listRecentInvoices(proxyUrl) {
  return requestInvoices(proxyUrl, "limit=20");
}

export async function listPaidInvoices(proxyUrl) {
  const invoices = await requestInvoices(proxyUrl, "status=paid");
  return invoices.filter((invoice) => invoice.paid);
}
