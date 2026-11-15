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

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase();
  if (["true", "1", "yes", "da", "paid", "achitat", "achitata", "încasat", "încasată"].includes(normalized)) return true;
  if (["false", "0", "no", "nu", "unpaid", "neachitat", "neachitata"].includes(normalized)) return false;
  return null;
}

function invoicePaymentState(invoice) {
  const rawStatus = invoice.status
    ?? invoice.paymentStatus
    ?? invoice.payment_status
    ?? invoice.statusName
    ?? invoice.status_name
    ?? invoice.invoiceStatus
    ?? invoice.invoice_status;
  const status = typeof rawStatus === "string" ? rawStatus.trim() : "";
  const normalizedStatus = status.toLocaleLowerCase();
  const unpaidStatus = /^(unpaid|not paid|neachitat|neincasat)/.test(normalizedStatus);
  const paidStatus = /^(paid|achitat|incasat|încasat|platit|plătit)/.test(normalizedStatus);
  const partialStatus = /^(partial|partially|parțial|partial|part-)/.test(normalizedStatus);
  const paidFlag = booleanValue(
    invoice.paid ?? invoice.isPaid ?? invoice.is_paid ?? invoice.fullyPaid ?? invoice.fully_paid
  );
  const rawPaidAmount = invoice.paidAmount
    ?? invoice.amountPaid
    ?? invoice.amount_paid
    ?? invoice.collectedAmount
    ?? invoice.collected_amount;
  const paidAmount = Number(rawPaidAmount);
  const total = Number(invoice.total ?? invoice.totalAmount ?? invoice.amount);
  const hasPaidAmount = rawPaidAmount !== undefined && rawPaidAmount !== null
    && Number.isFinite(paidAmount) && paidAmount >= 0;
  const paidInFullByAmount = hasPaidAmount && Number.isFinite(total) && total > 0 && paidAmount >= total;
  const partiallyPaidByAmount = hasPaidAmount && paidAmount > 0 && !paidInFullByAmount;
  const explicitlyUnpaid = booleanValue(
    invoice.unpaid ?? invoice.isUnpaid ?? invoice.is_unpaid
  ) === true;
  const paid = !unpaidStatus && !partialStatus
    && (paidFlag === true || paidStatus || paidInFullByAmount);

  let displayStatus = status;
  if (partialStatus || partiallyPaidByAmount) displayStatus = "Parțial achitată";
  else if (paid) displayStatus = "Achitată";
  else if (unpaidStatus || explicitlyUnpaid || paidFlag === false || hasPaidAmount) displayStatus = "Neachitată";
  else if (!displayStatus || /^(unknown|necunoscut[ăa]?|n\/a)$/i.test(displayStatus)) displayStatus = "Emisă";
  return { status: displayStatus, paid };
}

function normalizeInvoice(invoice) {
  const client = typeof invoice.client === "string"
    ? invoice.client
    : invoice.client?.name ?? invoice.clientName ?? invoice.customerName ?? "";
  const number = invoice.number ?? invoice.invoiceNumber ?? invoice.seriesNumber
    ?? [invoice.seriesName, invoice.number].filter(Boolean).join(" ");
  const total = Number(invoice.total ?? invoice.totalAmount ?? invoice.amount);
  const paymentState = invoicePaymentState(invoice);
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
    status: paymentState.status,
    paid: paymentState.paid
  };
}

export function listRecentInvoices(proxyUrl) {
  return requestInvoices(proxyUrl, "limit=20");
}

export async function listPaidInvoices(proxyUrl) {
  const invoices = await requestInvoices(proxyUrl, "status=paid");
  return invoices.filter((invoice) => invoice.paid);
}
