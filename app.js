import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { listPaidInvoices, listRecentInvoices } from "./oblioService.js";

const $ = (selector) => document.querySelector(selector);
const configuredOblioProxyUrl = "__VITE_OBLIO_PROXY_URL__";
const money = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" });
const skuCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const state = {
  user: null,
  events: [],
  activeEventId: "",
  marketHistoryYear: "all",
  marketHistorySoldTotals: {},
  marketHistoryHasInventoryTotals: false,
  marketHistoryLoading: false,
  marketHistoryError: "",
  inventory: [],
  materials: [],
  materialsUnsubscribe: null,
  materialsLoading: false,
  materialsSearch: "",
  editingMaterialId: null,
  selectedCategory: "All",
  search: "",
  sortBy: "sku",
  sortDirection: 1,
  editingId: null,
  imageBase64: "",
  inventoryUnsubscribe: null,
  catalogUnsubscribe: null,
  categoriesUnsubscribe: null,
  catalog: [],
  categories: ["Magnet", "Brosa", "Globulet"],
  categoryRecords: [],
  catalogSearch: "",
  catalogCategory: "All",
  pickerSearch: "",
  pickerCategory: "All",
  editingCatalogId: null,
  catalogVariants: [],
  selectedCatalogProductId: "",
  editingCategoryId: null,
  currentPage: "dashboard",
  currentModule: "hub",
  catalogMigrationStarted: false,
  toastTimer: null,
  inventoryLoading: false,
  accountingEntries: [],
  accountingUnsubscribe: null,
  accountingLoading: false,
  accountingImportValidation: null,
  accountingImportValidationKey: "",
  accountingYear: String(new Date().getFullYear()),
  accountingFiscalYear: String(new Date().getFullYear()),
  accountingView: "journal",
  accountingMonth: "all",
  accountingSearch: "",
  editingAccountingId: null,
  accountingNumberEdited: false,
  f4109StorageWarningShown: false,
  oblioProxyUrl: configuredOblioProxyUrl === "__VITE_OBLIO_PROXY_URL__" ? "" : configuredOblioProxyUrl.trim(),
  oblioInvoices: [],
  oblioInvoicesLoaded: false
};

const loginScreen = $("#login-screen");
const appShell = $("#app-shell");
const eventDialog = $("#event-dialog");
const materialDialog = $("#material-dialog");
const marketCloseDialog = $("#market-close-dialog");
const pastMarketDialog = $("#past-market-dialog");
const inventoryDialog = $("#inventory-dialog");
const productPickerDialog = $("#product-picker-dialog");
const productQuantityDialog = $("#product-quantity-dialog");
const catalogItemDialog = $("#catalog-item-dialog");
const categoryDialog = $("#category-dialog");
const settingsDialog = $("#settings-dialog");
const importDialog = $("#import-dialog");
const accountDialog = $("#account-dialog");
const accountingDialog = $("#accounting-dialog");
const inventoryForm = $("#inventory-form");
const materialForm = $("#material-form");
const eventForm = $("#event-form");
const settingsForm = $("#settings-form");
const accountingForm = $("#accounting-form");
const accountingImportForm = $("#accounting-import-form");

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function clearError(element) {
  element.textContent = "";
  element.hidden = true;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toast(message, isError = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => element.classList.remove("is-visible"), 2800);
}

function setConnectionStatus() {
  const status = $("#connection-status");
  const online = navigator.onLine;
  status.textContent = online ? "Conectat" : "Fără conexiune";
  status.classList.toggle("is-offline", !online);
}

function setScreen(screen) {
  $("#loading-screen").hidden = true;
  loginScreen.hidden = screen !== "login";
  appShell.hidden = screen !== "app";
}

function configureLogin() {
  const notice = $("#config-notice");
  const button = $("#login-button");
  if (!isFirebaseConfigured) {
    notice.textContent = "Configurează mai întâi Firebase: adaugă setările proiectului în firebase-config.js, apoi reîncarcă pagina.";
    notice.hidden = false;
    button.disabled = true;
  }
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const dateOrder = String(b.startDate ?? b.date ?? "").localeCompare(String(a.startDate ?? a.date ?? ""));
    if (dateOrder !== 0) return dateOrder;
    return String(b.name ?? "").localeCompare(String(a.name ?? ""));
  });
}

function eventDateRange(event) {
  const startDate = event.startDate ?? event.date ?? "";
  const endDate = event.endDate ?? "";
  return endDate && endDate !== startDate ? `${startDate} – ${endDate}` : startDate;
}

function eventIsClosed(event) {
  return event?.status === "closed";
}

function eventTypeLabel(type) {
  return type === "Market" ? "Târg" : "Shop Update";
}

function categoryLabel(category) {
  return ({ Brosa: "Broșă", Globulet: "Globuleț" })[category] ?? category;
}

function soldQuantityForMarket(items) {
  return items.reduce((total, item) => total + numberValue(item.soldQty), 0);
}

function marketDurationDays(event) {
  if (Number.isInteger(event.durationDays) && event.durationDays > 0) return event.durationDays;
  const start = String(event.startDate ?? event.date ?? "");
  const end = String(event.endDate ?? event.date ?? start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 0;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

function marketDateLabel(value) {
  const [year, month, day] = String(value ?? "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

function renderEvents() {
  const selectedId = state.activeEventId;
  if (!state.events.some((event) => event.id === selectedId)) {
    state.activeEventId = state.events[0]?.id ?? "";
  }

  const activeEvent = state.events.find((event) => event.id === state.activeEventId);
  $("#event-select-value").textContent = activeEvent?.name ?? "Nu există târguri — creează primul târg";
  $("#event-select-button").disabled = state.events.length === 0;
  $("#event-menu").innerHTML = state.events.map((event) => `
    <button class="event-menu-option" type="button" role="option" data-event-id="${escapeHtml(event.id)}" aria-selected="${event.id === state.activeEventId}">
      <span class="event-menu-name">${escapeHtml(event.name)}</span>
      <span class="event-menu-meta">${eventTypeLabel(event.type)} · ${escapeHtml(eventDateRange(event))}${eventIsClosed(event) ? " · Încheiat" : ""}</span>
    </button>
  `).join("");
  if (state.events.length === 0) {
    $("#event-menu").hidden = true;
    $("#event-select-button").setAttribute("aria-expanded", "false");
  }
  const selectedEvent = state.events.find((event) => event.id === state.activeEventId);
  $("#add-inventory-button").disabled = !selectedEvent || eventIsClosed(selectedEvent);
  $("#mobile-add-button").disabled = !selectedEvent || eventIsClosed(selectedEvent);
  renderActiveEvent();
  subscribeToInventory();
  renderMarketHistory();
}

function renderActiveEvent() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  const heading = $("#event-heading");
  heading.hidden = !event;
  if (!event) {
    $("#close-market-button").hidden = true;
    $("#refresh-market-total-button").hidden = true;
    return;
  }
  $("#event-type").textContent = event.type;
  $("#event-name").textContent = event.name;
  $("#event-details").textContent = [eventDateRange(event), event.location, event.organizer].filter(Boolean).join(" · ");
  $("#event-type").textContent = eventTypeLabel(event.type);
  $("#event-status").textContent = eventIsClosed(event) ? "Încheiat" : "În desfășurare";
  $("#event-status").classList.toggle("is-closed", eventIsClosed(event));
  $("#close-market-button").hidden = event.type !== "Market" || eventIsClosed(event);
  $("#refresh-market-total-button").hidden = event.type !== "Market" || !eventIsClosed(event);
}

function renderMarketHistory() {
  const tableBody = $("#market-history-table-body");
  if (!tableBody) return;
  const markets = state.events.filter((event) => event.type === "Market");
  const years = [...new Set(markets.map((event) => String(event.startDate ?? event.date ?? "").slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year)))].sort((a, b) => b.localeCompare(a));
  const yearSelect = $("#market-history-year");
  const previousYear = state.marketHistoryYear;
  yearSelect.innerHTML = `<option value="all">Toți anii</option>${years.map((year) => `<option value="${year}">${year}</option>`).join("")}`;
  if (state.marketHistoryYear !== "all" && !years.includes(state.marketHistoryYear)) state.marketHistoryYear = "all";
  yearSelect.value = state.marketHistoryYear;
  if (previousYear !== state.marketHistoryYear) $("#market-history-year").value = state.marketHistoryYear;
  const filtered = markets.filter((market) => state.marketHistoryYear === "all"
    || String(market.startDate ?? market.date ?? "").slice(0, 4) === state.marketHistoryYear);
  const grouped = new Map();
  filtered.forEach((market) => {
    const year = String(market.startDate ?? market.date ?? "").slice(0, 4);
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(market);
  });

  $("#market-history-status").hidden = !state.marketHistoryLoading && !state.marketHistoryError;
  $("#market-history-status").textContent = state.marketHistoryError
    || (state.marketHistoryLoading ? "Se încarcă totalul produselor vândute…" : "");
  $("#market-history-empty").hidden = state.marketHistoryLoading || filtered.length > 0;
  const rows = [];
  [...grouped.keys()].sort((a, b) => b.localeCompare(a)).forEach((year) => {
    const yearMarkets = grouped.get(year).sort((a, b) =>
      String(b.startDate ?? b.date ?? "").localeCompare(String(a.startDate ?? a.date ?? "")));
    const totals = { cash: 0, bank: 0, income: 0, sold: 0 };
    yearMarkets.forEach((market) => {
      const cash = numberValue(market.cashIncome);
      const bank = numberValue(market.bankIncome);
      const sold = typeof market.totalItemsSold === "number"
        ? market.totalItemsSold
        : state.marketHistoryHasInventoryTotals
          ? numberValue(state.marketHistorySoldTotals[market.id])
          : null;
      totals.cash += cash;
      totals.bank += bank;
      totals.income += cash + bank;
      if (sold !== null) totals.sold += sold;
      const start = marketDateLabel(market.startDate ?? market.date);
      const end = marketDateLabel(market.endDate ?? market.date ?? market.startDate);
      rows.push(`<tr>
        <td>${escapeHtml(start)}${end && end !== start ? ` – ${escapeHtml(end)}` : ""}</td>
        <td>${marketDurationDays(market)}</td>
        <td>${escapeHtml(market.location ?? "")}</td>
        <td>${escapeHtml(market.organizer ?? "")}</td>
        <td>${escapeHtml(market.edition ?? "")}</td>
        <td>${money.format(cash)}</td>
        <td>${money.format(bank)}</td>
        <td>${money.format(cash + bank)}</td>
        <td>${sold === null ? "—" : sold}</td>
      </tr>`);
    });
    rows.push(`<tr class="market-history-total-row">
      <th colspan="5" scope="row">Total pentru ${escapeHtml(year)}</th>
      <td>${money.format(totals.cash)}</td>
      <td>${money.format(totals.bank)}</td>
      <td>${money.format(totals.income)}</td>
      <td>${state.marketHistoryHasInventoryTotals || yearMarkets.every((market) => typeof market.totalItemsSold === "number") ? totals.sold : "—"}</td>
    </tr>`);
  });
  tableBody.innerHTML = rows.join("");
}

async function loadMarketHistoryInventoryTotals() {
  state.marketHistoryLoading = true;
  state.marketHistoryError = "";
  renderMarketHistory();
  try {
    const snapshot = await getDocsFromServer(collection(db, "inventory"));
    const totals = {};
    snapshot.docs.forEach((document) => {
      const item = document.data();
      totals[item.marketId] = (totals[item.marketId] ?? 0) + numberValue(item.soldQty);
    });
    state.marketHistorySoldTotals = totals;
    state.marketHistoryHasInventoryTotals = true;
  } catch (error) {
    state.marketHistoryError = `Nu s-au putut încărca totalurile produselor vândute: ${error.message}`;
    console.error("Could not load market history inventory totals.", error);
    toast(state.marketHistoryError, true);
  } finally {
    state.marketHistoryLoading = false;
    renderMarketHistory();
  }
}

function subscribeToEvents() {
  onSnapshot(
    query(collection(db, "events")),
    (snapshot) => {
      state.events = sortEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      renderEvents();
    },
    (error) => {
      console.error("Could not load events.", error);
      toast(`Nu s-au putut încărca târgurile: ${error.message}`, true);
    }
  );
}

function startCatalogListeners() {
  state.catalogUnsubscribe?.();
  state.categoriesUnsubscribe?.();
  state.catalogUnsubscribe = onSnapshot(collection(db, "products"), (snapshot) => {
    state.catalog = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" }));
    renderCatalog();
    renderProductPicker();
    if (!state.catalogMigrationStarted) {
      state.catalogMigrationStarted = true;
      void migrateInventoryToCatalog();
    }
  }, (error) => {
    console.error("Could not load item catalog.", error);
    toast(`Nu s-a putut încărca catalogul de produse: ${error.message}`, true);
  });

  state.categoriesUnsubscribe = onSnapshot(collection(db, "categories"), (snapshot) => {
    if (snapshot.empty) {
      state.categories = ["Magnet", "Brosa", "Globulet"];
      state.categoryRecords = [];
      void initializeDefaultCategories();
    } else {
      state.categoryRecords = snapshot.docs.map((item) => ({ id: item.id, name: item.data().name }));
      state.categories = state.categoryRecords.map((item) => item.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    renderCategoryControls();
    renderCatalog();
    renderProductPicker();
    renderInventory();
    renderCategoryList();
  }, (error) => {
    console.error("Could not load item categories.", error);
    toast(`Nu s-au putut încărca categoriile: ${error.message}`, true);
  });
}

function categoryDocumentId(name) {
  const bytes = new TextEncoder().encode(name.trim().toLocaleLowerCase());
  return `category-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function initializeDefaultCategories() {
  if (!navigator.onLine || state.categoryRecords.length) return;
  try {
    const snapshot = await getDocs(collection(db, "categories"));
    if (!snapshot.empty) return;
    const batch = writeBatch(db);
    ["Magnet", "Brosa", "Globulet"].forEach((name) => {
      batch.set(doc(db, "categories", categoryDocumentId(name)), {
        name,
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();
  } catch (error) {
    console.error("Could not initialize default categories.", error);
    toast(`Nu s-au putut inițializa categoriile implicite: ${error.message}`, true);
  }
}

async function migrateInventoryToCatalog() {
  try {
    const [inventorySnapshot, catalogSnapshot] = await Promise.all([
      getDocs(collection(db, "inventory")),
      getDocs(collection(db, "products"))
    ]);
    const existingSkus = new Set(catalogSnapshot.docs.map((item) => String(item.data().sku ?? "").trim().toLocaleLowerCase()));
    const legacyProducts = new Map();
    inventorySnapshot.docs.forEach((item) => {
      const product = item.data();
      const sku = String(product.sku ?? "").trim();
      if (!sku) return;
      const key = sku.toLocaleLowerCase();
      if (existingSkus.has(key)) return;
      const previous = legacyProducts.get(key);
      const currentTimestamp = product.updatedAt?.toMillis?.() ?? 0;
      const previousTimestamp = previous?.updatedAt?.toMillis?.() ?? 0;
      if (!previous || currentTimestamp >= previousTimestamp) legacyProducts.set(key, product);
    });

    const products = [...legacyProducts.values()];
    for (let start = 0; start < products.length; start += 450) {
      const batch = writeBatch(db);
      products.slice(start, start + 450).forEach((product) => {
        const productRef = doc(collection(db, "products"));
        batch.set(productRef, {
          sku: String(product.sku ?? "").trim(),
          name: product.name ?? "",
          category: product.category ?? "Other",
          imageBase64: product.imageBase64 ?? "",
          price: numberValue(product.price),
          unitCost: numberValue(product.unitCost),
          notes: product.notes ?? "",
          variants: [{
            id: "default",
            color: String(product.color ?? "Standard"),
            imageBase64: String(product.imageBase64 ?? "")
          }],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }

    const missingCategories = [...new Set(products.map((product) => String(product.category ?? "").trim()).filter(Boolean))]
      .filter((name) => !state.categories.some((category) => category.toLocaleLowerCase() === name.toLocaleLowerCase()));
    if (missingCategories.length) {
      const batch = writeBatch(db);
      missingCategories.forEach((name) => {
        batch.set(doc(db, "categories", categoryDocumentId(name)), { name, createdAt: serverTimestamp() });
      });
      await batch.commit();
    }
  } catch (error) {
    console.error("Could not migrate existing inventory into the item catalog.", error);
    toast(`Nu s-a putut pregăti catalogul de produse: ${error.message}`, true);
  }
}

function renderCategoryControls() {
  const options = state.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(categoryLabel(category))}</option>`).join("");
  const catalogSelection = $("#catalog-item-category").value;
  const inventorySelection = inventoryForm.elements.category.value;
  $("#catalog-item-category").innerHTML = options;
  inventoryForm.elements.category.innerHTML = options;
  if (state.categories.includes(catalogSelection)) $("#catalog-item-category").value = catalogSelection;
  if (state.categories.includes(inventorySelection)) inventoryForm.elements.category.value = inventorySelection;

  const catalogFilter = $("#catalog-category-filter");
  const previousCatalogFilter = state.catalogCategory;
  catalogFilter.innerHTML = `<option value="All">Toate categoriile</option>${options}`;
  if (state.categories.includes(previousCatalogFilter)) catalogFilter.value = previousCatalogFilter;
  else catalogFilter.value = "All";

  const pickerFilter = $("#product-picker-category");
  const previousPickerFilter = state.pickerCategory;
  pickerFilter.innerHTML = `<option value="All">Toate categoriile</option>${options}`;
  if (state.categories.includes(previousPickerFilter)) pickerFilter.value = previousPickerFilter;
  else pickerFilter.value = "All";
}

function renderCatalog() {
  if (!$("#catalog-grid")) return;
  const search = state.catalogSearch.trim().toLocaleLowerCase();
  const products = state.catalog.filter((product) =>
    (state.catalogCategory === "All" || product.category === state.catalogCategory)
    && (!search
      || String(product.sku ?? "").toLocaleLowerCase().includes(search)
      || String(product.name ?? "").toLocaleLowerCase().includes(search)
      || catalogVariants(product).some((variant) => variant.color.toLocaleLowerCase().includes(search)))
  ).sort((a, b) => skuCollator.compare(String(a.sku ?? ""), String(b.sku ?? "")));
  if (![...$("#catalog-category-filter").options].some((option) => option.value === state.catalogCategory)) {
    state.catalogCategory = "All";
  }
  $("#catalog-category-filter").value = state.catalogCategory;
  $("#catalog-loading").hidden = false;
  $("#catalog-empty-state").hidden = true;
  $("#catalog-grid").innerHTML = products.map((product) => `
    <article class="catalog-card">
      <div class="catalog-card-image product-thumb">${imageMarkup({ imageBase64: catalogVariants(product)[0]?.imageBase64 })}</div>
      <div class="catalog-card-main">
        <div class="catalog-card-title">
          <div><h2>${escapeHtml(product.name)}</h2><span class="sku-badge">${escapeHtml(product.sku)}</span></div>
          <span class="product-card-category">${escapeHtml(categoryLabel(product.category))}</span>
        </div>
        <strong class="catalog-price">${money.format(numberValue(product.price))}</strong>
        <div class="catalog-variant-list">${catalogVariants(product).map((variant) => `
          <div class="catalog-variant-summary">
            <span class="product-thumb">${imageMarkup({ imageBase64: variant.imageBase64 })}</span>
            <strong>${escapeHtml(variant.color)}</strong>
          </div>
        `).join("")}</div>
        <div class="catalog-card-actions">
          <button class="button button-outline" type="button" data-catalog-action="edit" data-id="${escapeHtml(product.id)}">Editează</button>
          <button class="button button-primary" type="button" data-catalog-action="add" data-id="${escapeHtml(product.id)}" ${!state.activeEventId || eventIsClosed(state.events.find((event) => event.id === state.activeEventId)) || !missingCatalogVariants(product).length ? "disabled" : ""}>Adaugă în târgul curent</button>
          <button class="button button-danger" type="button" data-catalog-action="delete" data-id="${escapeHtml(product.id)}">Șterge</button>
        </div>
      </div>
    </article>
  `).join("");
  $("#catalog-empty-state").hidden = state.catalog.length > 0;
  $("#catalog-loading").hidden = true;
}

function nextCatalogSku(products) {
  const numericSkus = products
    .map((product) => String(product.sku ?? "").trim())
    .filter((sku) => /^\d+$/.test(sku));
  const nextNumber = numericSkus.reduce((maximum, sku) => {
    const value = BigInt(sku);
    return value > maximum ? value : maximum;
  }, 0n) + 1n;
  const width = Math.max(3, ...numericSkus.map((sku) => sku.length));
  return String(nextNumber).padStart(width, "0");
}

function catalogVariants(product) {
  if (Array.isArray(product.variants) && product.variants.length) {
    return product.variants.map((variant) => ({
      id: String(variant.id ?? ""),
      color: String(variant.color ?? "Standard"),
      imageBase64: String(variant.imageBase64 ?? "")
    }));
  }
  return [{
    id: "default",
    color: String(product.color ?? "Standard"),
    imageBase64: String(product.imageBase64 ?? "")
  }];
}

function marketVariantId(item) {
  return String(item.variantId ?? "default");
}

function missingCatalogVariants(product) {
  const existing = new Set(state.inventory
    .filter((item) => item.productId === product.id
      || (!item.productId && String(item.sku ?? "").trim().toLocaleLowerCase() === String(product.sku ?? "").trim().toLocaleLowerCase()))
    .map(marketVariantId));
  return catalogVariants(product).filter((variant) => !existing.has(variant.id));
}

function createVariantId() {
  return crypto.randomUUID();
}

function renderCatalogVariants() {
  $("#catalog-variants").innerHTML = state.catalogVariants.map((variant, index) => `
    <article class="catalog-variant-editor" data-variant-row data-variant-id="${escapeHtml(variant.id)}">
      <div class="catalog-variant-editor-top">
        <span class="variant-index">Culoarea ${index + 1}</span>
        <button class="text-button danger" type="button" data-remove-variant="${escapeHtml(variant.id)}" ${state.catalogVariants.length <= 1 ? "disabled" : ""}>Șterge</button>
      </div>
      <div class="variant-editor-fields">
        <div class="product-thumb variant-image-preview">${imageMarkup({ imageBase64: variant.imageBase64 })}</div>
        <label>Denumire culoare<input data-variant-color type="text" maxlength="50" value="${escapeHtml(variant.color)}" placeholder="de ex. Fundal roșu" required></label>
        <label class="variant-photo-picker">Fotografie<input data-variant-image type="file" accept="image/*"><small>Imagine opțională pentru această culoare.</small></label>
      </div>
    </article>
  `).join("");
}

function renderProductPicker() {
  const search = state.pickerSearch.trim().toLocaleLowerCase();
  const products = state.catalog.filter((product) =>
    (state.pickerCategory === "All" || product.category === state.pickerCategory)
    && (!search
      || String(product.sku ?? "").toLocaleLowerCase().includes(search)
      || String(product.name ?? "").toLocaleLowerCase().includes(search)
      || catalogVariants(product).some((variant) => variant.color.toLocaleLowerCase().includes(search)))
  );
  $("#product-picker-list").innerHTML = products.map((product) => {
    const remaining = missingCatalogVariants(product);
    const alreadyAdded = remaining.length === 0;
    const closed = eventIsClosed(state.events.find((event) => event.id === state.activeEventId));
    return `<button class="picker-product" type="button" data-picker-product="${escapeHtml(product.id)}" ${alreadyAdded || closed ? "disabled" : ""}>
      <span class="product-thumb">${imageMarkup({ imageBase64: catalogVariants(product)[0]?.imageBase64 })}</span>
      <span class="picker-product-main"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · ${escapeHtml(categoryLabel(product.category))} · ${remaining.length} ${remaining.length === 1 ? "culoare de adăugat" : "culori de adăugat"}</small></span>
      <span class="picker-product-price">${money.format(numberValue(product.price))}</span>
      <span class="picker-product-action">${alreadyAdded ? "Adăugat" : "＋"}</span>
    </button>`;
  }).join("");
  $("#product-picker-empty").hidden = products.length > 0;
}

function renderCategoryList() {
  const list = $("#category-list");
  if (!list) return;
  list.innerHTML = state.categoryRecords.map((category) => {
    const inUse = state.catalog.some((product) => product.category === category.name);
    return `<div class="category-list-row">
      <strong>${escapeHtml(category.name)}</strong>
      <span class="category-row-actions">
        <button class="text-button" type="button" data-category-action="edit" data-id="${escapeHtml(category.id)}">Redenumește</button>
        <button class="text-button danger" type="button" data-category-action="delete" data-id="${escapeHtml(category.id)}" ${inUse ? "disabled" : ""}>Șterge</button>
      </span>
    </div>`;
  }).join("");
}

function materialQuantity(value, unit) {
  const maximumFractionDigits = unit === "pcs" ? 0 : 2;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(numberValue(value));
}

function materialUnitLabel(unit) {
  return unit === "pcs" ? "buc." : String(unit ?? "pcs");
}

function materialQuantityControl(material) {
  const used = numberValue(material.usedQuantity);
  const quantity = numberValue(material.quantity);
  return `<span class="material-used-control">
    <button class="stepper-button" type="button" data-material-action="used-minus" data-id="${escapeHtml(material.id)}" aria-label="Scade cantitatea folosită pentru ${escapeHtml(material.name)}" ${used <= 0 ? "disabled" : ""}>−</button>
    <strong>${materialQuantity(used, material.unit)}</strong>
    <button class="stepper-button" type="button" data-material-action="used-plus" data-id="${escapeHtml(material.id)}" aria-label="Crește cantitatea folosită pentru ${escapeHtml(material.name)}" ${used >= quantity ? "disabled" : ""}>+</button>
  </span>`;
}

function materialActions(material) {
  return `<span class="row-actions">
    <button class="text-button" type="button" data-material-action="edit" data-id="${escapeHtml(material.id)}">Editează</button>
    <button class="text-button danger" type="button" data-material-action="delete" data-id="${escapeHtml(material.id)}">Șterge</button>
  </span>`;
}

function renderMaterials() {
  const search = state.materialsSearch.trim().toLocaleLowerCase();
  const filtered = state.materials.filter((material) =>
    !search
    || String(material.name ?? "").toLocaleLowerCase().includes(search)
    || String(material.distributor ?? "").toLocaleLowerCase().includes(search)
  ).sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" }));
  $("#materials-loading").hidden = !state.materialsLoading;
  $("#materials-empty").hidden = state.materialsLoading || filtered.length > 0;
  $("#materials-empty-title").textContent = state.materials.length ? "Nu s-au găsit materiale" : "Lista ta de materiale începe aici";
  $("#materials-empty-description").textContent = state.materials.length
    ? "Încearcă altă denumire de material sau alt distribuitor."
    : "Adaugă materiale pentru a urmări cantitățile și consumul.";
  $("#materials-empty-add-button").hidden = state.materials.length > 0;
  $(".materials-table-wrap").hidden = state.materialsLoading || filtered.length === 0;
  $("#materials-mobile-list").innerHTML = filtered.map((material) => {
    const remaining = Math.max(0, numberValue(material.quantity) - numberValue(material.usedQuantity));
    const unit = materialUnitLabel(material.unit);
    const totalPrice = numberValue(material.price) * numberValue(material.quantity);
    return `<article class="materials-mobile-card">
      <div class="materials-mobile-card-heading">
        <div><h2>${escapeHtml(material.name)}</h2><p>${escapeHtml(material.distributor || "Fără distribuitor")}</p></div>
        <strong>${money.format(numberValue(material.price))}<small> / ${escapeHtml(unit)}</small></strong>
      </div>
      <div class="materials-mobile-quantities">
        <span>Preț total <strong>${money.format(totalPrice)}</strong></span>
        <span>Cantitate <strong>${materialQuantity(material.quantity, unit)} ${escapeHtml(unit)}</strong></span>
        <span>Folosită ${materialQuantityControl(material)}</span>
        <span>Disponibil <strong>${materialQuantity(remaining, unit)} ${escapeHtml(unit)}</strong></span>
      </div>
      <div class="materials-mobile-actions">${materialActions(material)}</div>
    </article>`;
  }).join("");
  $("#materials-table-body").innerHTML = filtered.map((material) => {
    const remaining = Math.max(0, numberValue(material.quantity) - numberValue(material.usedQuantity));
    const unit = materialUnitLabel(material.unit);
    const totalPrice = numberValue(material.price) * numberValue(material.quantity);
    return `<tr>
      <td>${escapeHtml(material.name)}</td>
      <td>${escapeHtml(material.distributor || "—")}</td>
      <td>${money.format(numberValue(material.price))} / ${escapeHtml(unit)}</td>
      <td>${money.format(totalPrice)}</td>
      <td>${materialQuantity(material.quantity, unit)} ${escapeHtml(unit)}</td>
      <td>${materialQuantityControl(material)}</td>
      <td>${materialQuantity(remaining, unit)} ${escapeHtml(unit)}</td>
      <td>${materialActions(material)}</td>
    </tr>`;
  }).join("");
}

function subscribeToMaterials() {
  state.materialsUnsubscribe?.();
  state.materialsLoading = true;
  renderMaterials();
  state.materialsUnsubscribe = onSnapshot(collection(db, "materials"), (snapshot) => {
    state.materials = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.materialsLoading = false;
    renderMaterials();
  }, (error) => {
    state.materialsLoading = false;
    renderMaterials();
    console.error("Could not load materials.", error);
    toast(`Nu s-au putut încărca materialele: ${error.message}`, true);
  });
}

function openMaterialDialog(material = null) {
  state.editingMaterialId = material?.id ?? null;
  materialForm.reset();
  const step = material?.unit === "pcs" || !material ? "1" : "0.01";
  materialForm.elements.quantity.step = step;
  materialForm.elements.usedQuantity.step = step;
  materialForm.elements.name.value = material?.name ?? "";
  materialForm.elements.distributor.value = material?.distributor ?? "";
  materialForm.elements.price.value = material ? numberValue(material.price) : 0;
  materialForm.elements.unit.value = material?.unit ?? "pcs";
  materialForm.elements.quantity.value = material ? numberValue(material.quantity) : 0;
  materialForm.elements.usedQuantity.value = material ? numberValue(material.usedQuantity) : 0;
  $("#material-form-title").textContent = material ? "Editează materialul" : "Adaugă material";
  $("#save-material-button").textContent = material ? "Salvează modificările" : "Salvează materialul";
  clearError($("#material-form-error"));
  materialDialog.showModal();
}

async function handleMaterialSubmit(event) {
  event.preventDefault();
  const button = $("#save-material-button");
  const errorElement = $("#material-form-error");
  clearError(errorElement);
  button.disabled = true;
  try {
    const values = new FormData(materialForm);
    const name = String(values.get("name")).trim();
    const distributor = String(values.get("distributor")).trim();
    const unit = String(values.get("unit"));
    const price = Number(values.get("price"));
    const quantity = Number(values.get("quantity"));
    const usedQuantity = Number(values.get("usedQuantity"));
    if (!name) throw new Error("Introdu denumirea materialului.");
    if (!["pcs", "m", "cm"].includes(unit)) throw new Error("Alege o unitate de măsură validă.");
    if (![price, quantity, usedQuantity].every(Number.isFinite) || price < 0 || quantity < 0 || usedQuantity < 0) {
      throw new Error("Prețul și cantitățile trebuie să fie numere valide, pozitive sau zero.");
    }
    if (unit === "pcs" && (![quantity, usedQuantity].every(Number.isInteger))) {
      throw new Error("Cantitatea în bucăți trebuie introdusă ca număr întreg.");
    }
    if (usedQuantity > quantity) throw new Error("Cantitatea folosită nu poate depăși cantitatea totală.");
    const payload = {
      name,
      distributor,
      price,
      unit,
      quantity,
      usedQuantity,
      updatedAt: serverTimestamp()
    };
    if (state.editingMaterialId) {
      await updateDoc(doc(db, "materials", state.editingMaterialId), payload);
    } else {
      await addDoc(collection(db, "materials"), { ...payload, createdAt: serverTimestamp() });
    }
    materialDialog.close();
    toast(state.editingMaterialId ? "Material actualizat." : "Material adăugat.");
  } catch (error) {
    console.error("Could not save material.", error);
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}

async function changeMaterialUsedQuantity(id, direction) {
  const material = state.materials.find((item) => item.id === id);
  if (!material) return;
  const quantity = numberValue(material.quantity);
  const used = numberValue(material.usedQuantity);
  const step = material.unit === "pcs" ? 1 : 0.1;
  const nextUsed = direction > 0
    ? Math.min(quantity, Math.round((used + step) * 100) / 100)
    : Math.max(0, Math.round((used - step) * 100) / 100);
  if (nextUsed === used) return;
  try {
    await updateDoc(doc(db, "materials", id), {
      usedQuantity: nextUsed,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Could not update material used quantity.", error);
    toast(`Nu s-a putut actualiza cantitatea folosită: ${error.message}`, true);
  }
}

async function deleteMaterial(id) {
  const material = state.materials.find((item) => item.id === id);
  if (!material || !window.confirm(`Ștergi materialul „${material.name}”? Acțiunea nu poate fi anulată.`)) return;
  try {
    await deleteDoc(doc(db, "materials", id));
    toast("Material șters.");
  } catch (error) {
    console.error("Could not delete material.", error);
    toast(`Nu s-a putut șterge materialul: ${error.message}`, true);
  }
}

function onMaterialAction(event) {
  const button = event.target.closest("[data-material-action]");
  if (!button) return;
  const { materialAction, id } = button.dataset;
  const material = state.materials.find((item) => item.id === id);
  if (materialAction === "edit" && material) openMaterialDialog(material);
  if (materialAction === "delete") void deleteMaterial(id);
  if (materialAction === "used-plus") void changeMaterialUsedQuantity(id, 1);
  if (materialAction === "used-minus") void changeMaterialUsedQuantity(id, -1);
}

function showPage(name) {
  state.currentPage = name;
  state.currentModule = name === "hub" ? "hub" : name === "accounting" ? "accounting" : "inventory";
  $("#workspace-page").hidden = name !== "hub";
  $("#inventory-home-page").hidden = name !== "inventory-home";
  $("#accounting-page").hidden = name !== "accounting";
  $("#dashboard-page").hidden = name !== "dashboard";
  $("#market-history-page").hidden = name !== "market-history";
  $("#materials-page").hidden = name !== "materials";
  $("#items-page").hidden = name !== "items";
  $("#settings-page").hidden = name !== "settings";
  $(".mobile-action-bar").hidden = name !== "dashboard";
  $("#back-button").hidden = name === "hub";
  $("#settings-button").setAttribute("aria-current", name === "settings" ? "page" : "false");
  $("#home-menu-button").setAttribute("aria-current", ["hub", "inventory-home", "dashboard", "market-history", "materials", "accounting", "items"].includes(name) ? "page" : "false");
  $("#home-menu").hidden = true;
  $("#home-menu-button").setAttribute("aria-expanded", "false");
  $("#home-menu").querySelectorAll("[data-nav-page]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.navPage === name
      || (button.dataset.navPage === "inventory-home" && ["dashboard", "market-history", "materials"].includes(name))
      ? "page"
      : "false");
  });
  if (name === "items") renderCatalog();
  if (name === "accounting") setAccountingView("home");
  if (name === "market-history") void loadMarketHistoryInventoryTotals();
  if (name === "materials") renderMaterials();
}

function goBackToParentPage() {
  if (state.currentPage === "accounting") {
    if (state.accountingView !== "home") {
      setAccountingView("home");
      return;
    }
    showPage("hub");
    return;
  }
  const parentPages = {
    "inventory-home": "hub",
    dashboard: "inventory-home",
    "market-history": "inventory-home",
    materials: "inventory-home"
  };
  showPage(parentPages[state.currentPage] ?? "hub");
}

function populatePastMarketYears() {
  const select = $("#past-market-year");
  const currentYear = new Date().getFullYear();
  select.innerHTML = Array.from({ length: currentYear + 5 - 1980 + 1 }, (_, index) => {
    const year = currentYear + 5 - index;
    return `<option value="${year}">${year}</option>`;
  }).join("");
  select.value = String(currentYear);
}

function syncPastMarketDates() {
  const form = $("#past-market-form");
  const year = form.elements.year.value;
  const start = form.elements.startDate.value;
  const end = form.elements.endDate.value;
  if (start && end && start.slice(0, 4) === year && end.slice(0, 4) === year && end >= start) {
    const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
    form.elements.durationDays.value = String(days);
  }
}

function updatePastMarketTotalIncome() {
  const form = $("#past-market-form");
  const cash = Number(form.elements.cashIncome.value);
  const bank = Number(form.elements.bankIncome.value);
  $("#past-market-total-income").value = money.format(
    (Number.isFinite(cash) ? cash : 0) + (Number.isFinite(bank) ? bank : 0)
  );
}

function openPastMarketDialog() {
  const form = $("#past-market-form");
  form.reset();
  populatePastMarketYears();
  const year = form.elements.year.value;
  form.elements.startDate.value = `${year}-01-01`;
  form.elements.endDate.value = `${year}-01-01`;
  form.elements.durationDays.value = "1";
  updatePastMarketTotalIncome();
  clearError($("#past-market-error"));
  pastMarketDialog.showModal();
}

async function handlePastMarketSubmit(event) {
  event.preventDefault();
  const form = $("#past-market-form");
  const button = $("#save-past-market-button");
  const errorElement = $("#past-market-error");
  clearError(errorElement);
  button.disabled = true;
  try {
    const values = new FormData(form);
    const year = String(values.get("year"));
    const startDate = String(values.get("startDate"));
    const endDate = String(values.get("endDate"));
    const durationDays = Number(values.get("durationDays"));
    const cashIncome = Number(values.get("cashIncome"));
    const bankIncome = Number(values.get("bankIncome"));
    const totalItemsSold = Number(values.get("totalItemsSold"));
    if (!/^\d{4}$/.test(year) || startDate.slice(0, 4) !== year || endDate.slice(0, 4) !== year) {
      throw new Error("Datele de început și de sfârșit trebuie să fie în anul selectat.");
    }
    if (endDate < startDate) throw new Error("Data de sfârșit trebuie să fie aceeași sau ulterioară datei de început.");
    if (!Number.isInteger(durationDays) || durationDays < 1) throw new Error("Numărul de zile trebuie să fie un număr întreg pozitiv.");
    if (![cashIncome, bankIncome].every((amount) => Number.isFinite(amount) && amount >= 0)) {
      throw new Error("Introdu sume valide, pozitive sau zero, pentru încasările în numerar și bancă.");
    }
    if (!Number.isInteger(totalItemsSold) || totalItemsSold < 0) {
      throw new Error("Numărul total de produse vândute trebuie să fie un număr întreg egal cu zero sau mai mare.");
    }

    await addDoc(collection(db, "events"), {
      name: String(values.get("name")).trim(),
      type: "Market",
      startDate,
      endDate,
      durationDays,
      location: String(values.get("location")).trim(),
      organizer: String(values.get("organizer")).trim(),
      edition: String(values.get("edition")).trim(),
      status: "closed",
      cashIncome,
      bankIncome,
      totalItemsSold,
      createdAt: serverTimestamp(),
      closedAt: serverTimestamp()
    });
    pastMarketDialog.close();
    toast(`Târg adăugat în istoricul anului ${year}.`);
  } catch (error) {
    console.error("Could not add past market history.", error);
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function accountingDateLabel(value) {
  const [year, month, day] = String(value ?? "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

function getFilteredAccountingEntries() {
  const search = state.accountingSearch.trim().toLocaleLowerCase();
  return state.accountingEntries
    .filter((entry) => state.accountingYear === "all" || String(entry.dataOperatiunii ?? "").slice(0, 4) === state.accountingYear)
    .filter((entry) => state.accountingMonth === "all" || String(entry.dataOperatiunii ?? "").slice(5, 7) === state.accountingMonth)
    .filter((entry) => !search
      || String(entry.document ?? "").toLocaleLowerCase().includes(search)
      || String(entry.explicatii ?? "").toLocaleLowerCase().includes(search))
    .sort((a, b) => String(a.dataOperatiunii ?? "").localeCompare(String(b.dataOperatiunii ?? ""))
      || numberValue(a.nrCrt) - numberValue(b.nrCrt));
}

function renderAccountingYearFilter() {
  const filter = $("#accounting-year-filter");
  const years = [...new Set(state.accountingEntries
    .map((entry) => String(entry.dataOperatiunii ?? "").slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year)))];
  const currentYear = String(new Date().getFullYear());
  if (!years.includes(currentYear)) years.push(currentYear);
  years.sort((a, b) => b.localeCompare(a));
  if (state.accountingYear !== "all" && !years.includes(state.accountingYear)) {
    state.accountingYear = currentYear;
  }
  filter.innerHTML = `<option value="all">Toți anii</option>${years.map((year) => `<option value="${year}">${year}</option>`).join("")}`;
  filter.value = state.accountingYear;
}

function accountingTotals(entries) {
  return entries.reduce((totals, entry) => {
    totals.cashIncome += numberValue(entry.incasariNumerar);
    totals.bankIncome += numberValue(entry.incasariBanca);
    totals.cashExpenses += numberValue(entry.platiNumerar);
    totals.bankExpenses += numberValue(entry.platiBanca);
    return totals;
  }, { cashIncome: 0, bankIncome: 0, cashExpenses: 0, bankExpenses: 0 });
}

function accountingAmount(value) {
  return money.format(numberValue(value));
}

function accountingYears() {
  const years = [...new Set(state.accountingEntries
    .map((entry) => String(entry.dataOperatiunii ?? "").slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year)))];
  const currentYear = String(new Date().getFullYear());
  if (!years.includes(currentYear)) years.push(currentYear);
  return years.sort((a, b) => b.localeCompare(a));
}

function limitedDeductibleAmount(entry, expenseTotal) {
  return Math.min(Math.max(0, expenseTotal), Math.max(0, numberValue(entry.deductibleLimitedAmount)));
}

function renderFiscalRegister() {
  const yearFilter = $("#accounting-fiscal-year-filter");
  const years = accountingYears();
  if (!years.includes(state.accountingFiscalYear)) {
    state.accountingFiscalYear = String(new Date().getFullYear());
  }
  yearFilter.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  yearFilter.value = state.accountingFiscalYear;

  const entries = state.accountingEntries
    .filter((entry) => String(entry.dataOperatiunii ?? "").slice(0, 4) === state.accountingFiscalYear)
    .sort((a, b) => String(a.dataOperatiunii ?? "").localeCompare(String(b.dataOperatiunii ?? ""))
      || numberValue(a.nrCrt) - numberValue(b.nrCrt));
  const incomes = entries.filter((entry) => entry.incomeFiscalType === "taxable"
    && numberValue(entry.incasariNumerar) + numberValue(entry.incasariBanca) > 0);
  const expenses = entries.filter((entry) => ["deductibleFull", "deductibleLimited"].includes(entry.expenseFiscalType)
    && numberValue(entry.platiNumerar) + numberValue(entry.platiBanca) > 0);
  const grossIncome = incomes.reduce((total, entry) =>
    total + numberValue(entry.incasariNumerar) + numberValue(entry.incasariBanca), 0);
  const deductibleExpenses = expenses.reduce((total, entry) => {
    const expenseTotal = numberValue(entry.platiNumerar) + numberValue(entry.platiBanca);
    return total + (entry.expenseFiscalType === "deductibleFull"
      ? expenseTotal
      : limitedDeductibleAmount(entry, expenseTotal));
  }, 0);

  $("#fiscal-income-body").innerHTML = incomes.map((entry, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(accountingDateLabel(entry.dataOperatiunii))}</td>
      <td>${escapeHtml(entry.document)}</td>
      <td>${escapeHtml(entry.explicatii)}</td>
      <td>${accountingAmount(numberValue(entry.incasariNumerar) + numberValue(entry.incasariBanca))}</td>
    </tr>
  `).join("");
  $("#fiscal-expense-body").innerHTML = expenses.map((entry, index) => {
    const total = numberValue(entry.platiNumerar) + numberValue(entry.platiBanca);
    const deductibleFull = entry.expenseFiscalType === "deductibleFull" ? total : 0;
    const deductibleLimited = entry.expenseFiscalType === "deductibleLimited"
      ? limitedDeductibleAmount(entry, total)
      : 0;
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(accountingDateLabel(entry.dataOperatiunii))}</td>
        <td>${escapeHtml(entry.document)}</td>
        <td>${escapeHtml(entry.explicatii)}</td>
        <td>${accountingAmount(total)}</td>
        <td>${accountingAmount(deductibleFull)}</td>
        <td>${accountingAmount(deductibleLimited)}</td>
      </tr>
    `;
  }).join("");
  $("#fiscal-income-empty").hidden = incomes.length > 0;
  $("#fiscal-expense-empty").hidden = expenses.length > 0;
  $("#fiscal-total-income").textContent = accountingAmount(grossIncome);
  $("#fiscal-total-expenses").textContent = accountingAmount(deductibleExpenses);
  $("#fiscal-net-income").textContent = accountingAmount(grossIncome - deductibleExpenses);
}

function renderF4109Reminder() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const storageKey = `brodal:f4109-dismissed:${monthKey}`;
  const reminder = $("#f4109-reminder");
  if (now.getDate() < 1 || now.getDate() > 20) {
    reminder.hidden = true;
    return;
  }
  try {
    reminder.hidden = localStorage.getItem(storageKey) === "true";
  } catch (error) {
    console.error("Could not read the F4109 reminder preference.", error);
    reminder.hidden = false;
    if (!state.f4109StorageWarningShown) {
      state.f4109StorageWarningShown = true;
      toast("Preferința de ascundere a reminderului F4109 nu a putut fi citită.", true);
    }
  }
}

function setAccountingView(view) {
  if (!["home", "journal", "fiscal", "oblio", "f4109"].includes(view)) return;
  state.accountingView = view;
  $("#accounting-hub-heading").hidden = view !== "home";
  $(".accounting-subnav").hidden = view !== "home";
  document.querySelectorAll("[data-accounting-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.accountingPanel !== view;
  });
  document.querySelectorAll("[data-accounting-view]").forEach((button) => {
    if (button.dataset.accountingView === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (state.currentPage === "accounting") {
    $("#back-button").textContent = view === "home" ? "← Înapoi" : "← Contabilitate";
  }
  renderAccounting();
}

function renderAccounting() {
  renderF4109Reminder();
  document.querySelectorAll("[data-accounting-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.accountingPanel !== state.accountingView;
  });
  renderAccountingYearFilter();
  $("#accounting-month-filter").value = state.accountingMonth;
  const entries = getFilteredAccountingEntries();
  const totals = accountingTotals(entries);
  $("#accounting-total-income").textContent = accountingAmount(totals.cashIncome + totals.bankIncome);
  $("#accounting-income-breakdown").textContent = `Numerar ${accountingAmount(totals.cashIncome)} · Bancă ${accountingAmount(totals.bankIncome)}`;
  $("#accounting-total-expenses").textContent = accountingAmount(totals.cashExpenses + totals.bankExpenses);
  $("#accounting-expense-breakdown").textContent = `Numerar ${accountingAmount(totals.cashExpenses)} · Bancă ${accountingAmount(totals.bankExpenses)}`;
  $("#accounting-cash-balance").textContent = accountingAmount(totals.cashIncome - totals.cashExpenses);
  $("#accounting-bank-balance").textContent = accountingAmount(totals.bankIncome - totals.bankExpenses);
  $("#accounting-loading").hidden = !state.accountingLoading;
  $("#accounting-empty").hidden = state.accountingLoading || entries.length > 0;
  $(".accounting-table-wrap").hidden = state.accountingLoading || entries.length === 0;
  $("#accounting-mobile-list").innerHTML = entries.map((entry) => `
    <article class="accounting-mobile-card">
      <div class="accounting-mobile-card-top">
        <span class="accounting-number-badge">Nr. ${escapeHtml(entry.nrCrt)}</span>
        <time class="accounting-mobile-date" datetime="${escapeHtml(entry.dataOperatiunii)}">${escapeHtml(accountingDateLabel(entry.dataOperatiunii))}</time>
      </div>
      <p class="accounting-mobile-document">${escapeHtml(entry.document)}</p>
      <p class="accounting-mobile-description">${escapeHtml(entry.explicatii)}</p>
      <div class="accounting-mobile-amounts">
        <div class="accounting-mobile-amount-group accounting-mobile-income"><strong>Încasări</strong><span>Numerar: ${accountingAmount(entry.incasariNumerar)}</span><span>Bancă: ${accountingAmount(entry.incasariBanca)}</span></div>
        <div class="accounting-mobile-amount-group accounting-mobile-expense"><strong>Plăți</strong><span>Numerar: ${accountingAmount(entry.platiNumerar)}</span><span>Bancă: ${accountingAmount(entry.platiBanca)}</span></div>
      </div>
      <div class="accounting-mobile-card-actions">
        <button class="text-button" type="button" data-accounting-action="edit" data-id="${escapeHtml(entry.id)}">Editează</button>
        <button class="text-button danger" type="button" data-accounting-action="delete" data-id="${escapeHtml(entry.id)}">Șterge</button>
      </div>
    </article>
  `).join("");
  $("#accounting-table-body").innerHTML = entries.map((entry) => `
    <tr>
      <td>${escapeHtml(entry.nrCrt)}</td>
      <td>${escapeHtml(accountingDateLabel(entry.dataOperatiunii))}</td>
      <td>${escapeHtml(entry.document)}</td>
      <td>${escapeHtml(entry.explicatii)}</td>
      <td>${accountingAmount(entry.incasariNumerar)}</td>
      <td>${accountingAmount(entry.incasariBanca)}</td>
      <td>${accountingAmount(entry.platiNumerar)}</td>
      <td>${accountingAmount(entry.platiBanca)}</td>
      <td><span class="accounting-row-actions">
        <button class="text-button" type="button" data-accounting-action="edit" data-id="${escapeHtml(entry.id)}">Editează</button>
        <button class="text-button danger" type="button" data-accounting-action="delete" data-id="${escapeHtml(entry.id)}">Șterge</button>
      </span></td>
    </tr>
  `).join("");
  $("#accounting-table-foot").innerHTML = entries.length ? `
    <tr>
      <td colspan="4">Total</td>
      <td>${accountingAmount(totals.cashIncome)}</td>
      <td>${accountingAmount(totals.bankIncome)}</td>
      <td>${accountingAmount(totals.cashExpenses)}</td>
      <td>${accountingAmount(totals.bankExpenses)}</td>
      <td></td>
    </tr>
  ` : "";
  renderFiscalRegister();
}

function subscribeToAccountingEntries() {
  state.accountingUnsubscribe?.();
  state.accountingLoading = true;
  renderAccounting();
  state.accountingUnsubscribe = onSnapshot(collection(db, "accounting_entries"), (snapshot) => {
    state.accountingEntries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.accountingLoading = false;
    renderAccounting();
  }, (error) => {
    state.accountingLoading = false;
    renderAccounting();
    console.error("Could not load accounting entries.", error);
    toast(`Nu s-au putut încărca operațiunile contabile: ${error.message}`, true);
  });
}

function nextAccountingEntryNumber(operationDate) {
  const year = state.accountingYear === "all" ? String(operationDate).slice(0, 4) : state.accountingYear;
  const entries = state.accountingEntries.filter((entry) =>
    String(entry.dataOperatiunii ?? "").slice(0, 4) === year
    && (state.accountingMonth === "all" || String(entry.dataOperatiunii ?? "").slice(5, 7) === state.accountingMonth)
  );
  return entries.reduce((maximum, entry) => Math.max(maximum, numberValue(entry.nrCrt)), 0) + 1;
}

function openAccountingDialog(entry = null) {
  state.editingAccountingId = entry?.id ?? null;
  state.accountingNumberEdited = false;
  accountingForm.reset();
  clearError($("#accounting-form-error"));
  $("#accounting-form-title").textContent = entry ? "Editează Operațiune" : "Adaugă Operațiune";
  $("#accounting-save-button").textContent = entry ? "Salvează Modificările" : "Salvează Operațiunea";
  accountingForm.elements.nrCrt.value = entry?.nrCrt ?? nextAccountingEntryNumber(localDateString());
  accountingForm.elements.dataOperatiunii.value = entry?.dataOperatiunii ?? localDateString();
  accountingForm.elements.document.value = entry?.document ?? "";
  accountingForm.elements.explicatii.value = entry?.explicatii ?? "";
  ["incasariNumerar", "incasariBanca", "platiNumerar", "platiBanca"].forEach((field) => {
    accountingForm.elements[field].value = entry ? numberValue(entry[field]) : 0;
  });
  accountingForm.elements.incomeFiscalType.value = entry
    ? entry.incomeFiscalType ?? "unclassified"
    : "unclassified";
  accountingForm.elements.expenseFiscalType.value = entry?.expenseFiscalType ?? "unclassified";
  accountingForm.elements.deductibleLimitedAmount.value = entry
    ? numberValue(entry.deductibleLimitedAmount)
    : 0;
  accountingDialog.showModal();
}

function openAccountingImportDialog() {
  accountingImportForm.reset();
  $("#accounting-import-year").value = String(new Date().getFullYear());
  $("#accounting-import-preview").textContent = "Alege anul și fișierul CSV pentru validarea rândurilor înainte de import.";
  clearError($("#accounting-import-error"));
  state.accountingImportValidation = null;
  state.accountingImportValidationKey = "";
  $("#accounting-import-dialog").showModal();
}

function accountingImportKey(file, year) {
  return `${file.name}:${file.size}:${file.lastModified}:${year}`;
}

function parseAccountingImportDate(value, rowNumber) {
  const dateValue = String(value ?? "").trim();
  let year;
  let month;
  let day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    [year, month, day] = dateValue.split("-").map(Number);
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateValue)) {
    [day, month, year] = dateValue.split(".").map(Number);
  } else {
    throw new Error(`Rândul ${rowNumber}: Data Operatiunii trebuie să fie în formatul YYYY-MM-DD sau DD.MM.YYYY.`);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Rândul ${rowNumber}: Data Operatiunii nu este o dată validă.`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAccountingImportAmount(value, fieldName, rowNumber) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 0;
  if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(normalized)) {
    throw new Error(`Rândul ${rowNumber}: ${fieldName} trebuie să fie un număr cu cel mult două zecimale.`);
  }
  const amount = Number(normalized.replace(",", "."));
  if (!Number.isFinite(amount)) throw new Error(`Rândul ${rowNumber}: ${fieldName} nu este un număr valid.`);
  return amount;
}

function accountingEntriesFromCsv(text, selectedYear) {
  if (!/^\d{4}$/.test(selectedYear)) throw new Error("Alege un an valid, format din patru cifre.");
  const [headers, ...rows] = parseCsv(text);
  const columns = new Map(headers.map((header, index) => [normalizeCsvHeader(header), index]));
  if (columns.size !== headers.length) throw new Error("Antetul CSV conține denumiri de coloane duplicate sau goale.");
  const required = [
    "nrcrt", "dataoperatiunii", "document", "explicatii",
    "incasarinumerar", "incasaribanca", "platinumerar", "platibanca"
  ];
  const missing = required.filter((header) => !columns.has(header));
  if (missing.length) {
    throw new Error(`Lipsește ${missing.length === 1 ? "coloana obligatorie" : "coloanele obligatorii"} din CSV: ${missing.join(", ")}.`);
  }

  const read = (cells, column) => (cells[columns.get(column)] ?? "").trim();
  const seenNumbers = new Set();
  const warnings = [];
  if (!columns.has("incomefiscaltype") || !columns.has("expensefiscaltype")) {
    warnings.push("clasificările fiscale lipsesc; operațiunile importate vor fi excluse din Registrul de Evidență Fiscală până la clasificare");
  }
  const entries = rows.map((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length !== headers.length) throw new Error(`Rândul ${rowNumber}: erau așteptate ${headers.length} coloane, dar au fost găsite ${cells.length}.`);
    const nrCrtText = read(cells, "nrcrt");
    const nrCrt = Number(nrCrtText);
    if (!/^\d+$/.test(nrCrtText) || !Number.isSafeInteger(nrCrt) || nrCrt < 1) {
      throw new Error(`Rândul ${rowNumber}: Nr. crt. trebuie să fie un număr întreg pozitiv.`);
    }
    if (seenNumbers.has(nrCrt)) throw new Error(`Rândul ${rowNumber}: Nr. crt. ${nrCrt} apare de mai multe ori în acest CSV.`);
    seenNumbers.add(nrCrt);
    const dataOperatiunii = parseAccountingImportDate(read(cells, "dataoperatiunii"), rowNumber);
    if (dataOperatiunii.slice(0, 4) !== selectedYear) {
      throw new Error(`Rândul ${rowNumber}: data ${dataOperatiunii} nu corespunde anului selectat ${selectedYear}.`);
    }
    const explicatii = read(cells, "explicatii");
    if (!explicatii) throw new Error(`Rândul ${rowNumber}: câmpul Explicatii nu poate fi gol.`);
    const document = read(cells, "document");
    if (!document) warnings.push(`înregistrarea ${nrCrt} nu are completat câmpul Document`);
    const incomeFiscalType = columns.has("incomefiscaltype") ? read(cells, "incomefiscaltype") : "unclassified";
    const expenseFiscalType = columns.has("expensefiscaltype") ? read(cells, "expensefiscaltype") : "unclassified";
    if (!["taxable", "nonTaxable", "ownerContribution", "unclassified"].includes(incomeFiscalType)) {
      throw new Error(`Rândul ${rowNumber}: Încadrarea fiscală a încasării nu este validă.`);
    }
    if (!["deductibleFull", "deductibleLimited", "nonDeductible", "personal", "unclassified"].includes(expenseFiscalType)) {
      throw new Error(`Rândul ${rowNumber}: Încadrarea fiscală a plății nu este validă.`);
    }
    const incasariNumerar = parseAccountingImportAmount(read(cells, "incasarinumerar"), "Incasari Numerar", rowNumber);
    const incasariBanca = parseAccountingImportAmount(read(cells, "incasaribanca"), "Incasari Banca", rowNumber);
    const platiNumerar = parseAccountingImportAmount(read(cells, "platinumerar"), "Plati Numerar", rowNumber);
    const platiBanca = parseAccountingImportAmount(read(cells, "platibanca"), "Plati Banca", rowNumber);
    const deductibleLimitedAmount = columns.has("deductiblelimitedamount")
      ? parseAccountingImportAmount(read(cells, "deductiblelimitedamount"), "Deductibil Limitat", rowNumber)
      : 0;
    if (expenseFiscalType === "deductibleLimited" && !columns.has("deductiblelimitedamount")) {
      throw new Error(`Rândul ${rowNumber}: exportul clasifică plata drept deductibilă limitat, dar lipsește coloana Deductibil Limitat.`);
    }
    if (deductibleLimitedAmount < 0
      || (expenseFiscalType === "deductibleLimited" && deductibleLimitedAmount > platiNumerar + platiBanca)) {
      throw new Error(`Rândul ${rowNumber}: Deductibil Limitat trebuie să fie pozitiv și să nu depășească totalul plăților.`);
    }
    return {
      nrCrt,
      dataOperatiunii,
      document,
      explicatii,
      incasariNumerar,
      incasariBanca,
      platiNumerar,
      platiBanca,
      incomeFiscalType,
      expenseFiscalType,
      deductibleLimitedAmount
    };
  });
  if (!entries.length) throw new Error("Fișierul CSV nu conține operațiuni contabile.");
  const signedCorrections = entries.filter((entry) =>
    entry.incasariNumerar < 0 || entry.incasariBanca < 0 || entry.platiNumerar < 0 || entry.platiBanca < 0
  ).length;
  if (signedCorrections) warnings.push(`${signedCorrections} ${signedCorrections === 1 ? "operațiune are" : "operațiuni au"} sume negative de corecție`);
  return { entries, warnings };
}

async function previewAccountingImport() {
  const file = $("#accounting-import-file").files?.[0];
  const year = $("#accounting-import-year").value.trim();
  state.accountingImportValidation = null;
  state.accountingImportValidationKey = "";
  clearError($("#accounting-import-error"));
  if (!file) {
    $("#accounting-import-preview").textContent = "Alege anul și fișierul CSV pentru validarea rândurilor înainte de import.";
    return;
  }
  try {
    const validation = accountingEntriesFromCsv(await file.text(), year);
    const key = accountingImportKey(file, year);
    state.accountingImportValidation = validation;
    state.accountingImportValidationKey = key;
    const warning = validation.warnings.length ? ` Atenție: ${validation.warnings.join("; ")}.` : "";
    $("#accounting-import-preview").textContent = `${validation.entries.length} operațiuni validate pentru anul ${year}.${warning} Importul va adăuga aceste operațiuni; numerele de înregistrare existente nu vor fi suprascrise.`;
  } catch (error) {
    $("#accounting-import-preview").textContent = "";
    showError($("#accounting-import-error"), error.message);
  }
}

async function handleAccountingImportSubmit(event) {
  event.preventDefault();
  const button = $("#accounting-import-button");
  const errorElement = $("#accounting-import-error");
  clearError(errorElement);
  const file = $("#accounting-import-file").files?.[0];
  const year = $("#accounting-import-year").value.trim();
  if (!file) {
    showError(errorElement, "Alege fișierul CSV cu operațiuni contabile pe care dorești să îl imporți.");
    return;
  }
  const key = accountingImportKey(file, year);
  let validation = state.accountingImportValidationKey === key ? state.accountingImportValidation : null;
  try {
    if (!validation) validation = accountingEntriesFromCsv(await file.text(), year);
    const { entries, warnings } = validation;
    if (!navigator.onLine) throw new Error("Conectează-te la internet înainte de a importa operațiunile contabile.");
    const existingSnapshot = await getDocsFromServer(collection(db, "accounting_entries"));
    const existingNumbers = new Set(existingSnapshot.docs
      .map((item) => item.data())
      .filter((entry) => String(entry.dataOperatiunii ?? "").slice(0, 4) === year)
      .map((entry) => Number(entry.nrCrt)));
    const collision = entries.find((entry) => existingNumbers.has(entry.nrCrt));
    if (collision) {
      throw new Error(`Numărul de înregistrare ${collision.nrCrt} există deja pentru anul ${year}. Nu a fost importat niciun rând; rezolvă conflictul și încearcă din nou.`);
    }
    const warningText = warnings.length ? `\n\nObservații CSV: ${warnings.join("; ")}.` : "";
    if (!window.confirm(`Adaugi ${entries.length} operațiuni contabile pentru anul ${year}? Înregistrările existente nu vor fi modificate.${warningText}`)) return;

    button.disabled = true;
    let importedCount = 0;
    try {
      for (let start = 0; start < entries.length; start += 450) {
        const batch = writeBatch(db);
        entries.slice(start, start + 450).forEach((entry) => {
          batch.set(doc(collection(db, "accounting_entries")), {
            ...entry,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
        importedCount += entries.slice(start, start + 450).length;
      }
    } catch (error) {
      console.error("Could not complete accounting CSV import.", error);
      throw new Error(`Importul s-a oprit după ${importedCount} din ${entries.length} operațiuni: ${error.message}`);
    }
    state.accountingYear = year;
    state.accountingMonth = "all";
    $("#accounting-month-filter").value = "all";
    $("#accounting-import-dialog").close();
    toast(`Au fost importate ${importedCount} operațiuni contabile pentru anul ${year}.`);
    renderAccounting();
  } catch (error) {
    console.error("Could not import accounting CSV.", error);
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleAccountingSubmit(event) {
  event.preventDefault();
  const submitButton = $("#accounting-save-button");
  const formError = $("#accounting-form-error");
  clearError(formError);
  submitButton.disabled = true;
  try {
    const formData = new FormData(accountingForm);
    const nrCrt = Number(formData.get("nrCrt"));
    const dataOperatiunii = String(formData.get("dataOperatiunii"));
    const explicatii = String(formData.get("explicatii")).trim();
    if (!Number.isInteger(nrCrt) || nrCrt < 1) throw new Error("Nr. crt. trebuie să fie un număr întreg pozitiv.");
    const [year, month, day] = dataOperatiunii.split("-").map(Number);
    const parsedDate = new Date(year, month - 1, day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataOperatiunii)
      || parsedDate.getFullYear() !== year
      || parsedDate.getMonth() !== month - 1
      || parsedDate.getDate() !== day) {
      throw new Error("Alege o dată validă pentru operațiune.");
    }
    if (!explicatii) throw new Error("Completează câmpul Explicații.");
    const incomeFiscalType = String(formData.get("incomeFiscalType"));
    const expenseFiscalType = String(formData.get("expenseFiscalType"));
    const deductibleLimitedAmount = Number(formData.get("deductibleLimitedAmount"));
    const expenseTotal = Number(formData.get("platiNumerar")) + Number(formData.get("platiBanca"));
    if (!["taxable", "nonTaxable", "ownerContribution", "unclassified"].includes(incomeFiscalType)) {
      throw new Error("Alege o încadrare fiscală validă pentru încasare.");
    }
    if (!["deductibleFull", "deductibleLimited", "nonDeductible", "personal", "unclassified"].includes(expenseFiscalType)) {
      throw new Error("Alege o încadrare fiscală validă pentru plată.");
    }
    if (!Number.isFinite(deductibleLimitedAmount) || deductibleLimitedAmount < 0
      || (expenseFiscalType === "deductibleLimited" && deductibleLimitedAmount > expenseTotal)) {
      throw new Error("Valoarea deductibilă limitat trebuie să fie pozitivă și să nu depășească totalul plăților.");
    }
    const payload = {
      nrCrt,
      dataOperatiunii,
      document: String(formData.get("document")),
      explicatii,
      incasariNumerar: Number(formData.get("incasariNumerar")),
      incasariBanca: Number(formData.get("incasariBanca")),
      platiNumerar: Number(formData.get("platiNumerar")),
      platiBanca: Number(formData.get("platiBanca")),
      incomeFiscalType,
      expenseFiscalType,
      deductibleLimitedAmount: expenseFiscalType === "deductibleLimited" ? deductibleLimitedAmount : 0,
      updatedAt: serverTimestamp()
    };
    if (Object.values(payload).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      throw new Error("Sumele trebuie să fie valori numerice valide.");
    }
    if (state.editingAccountingId) {
      await updateDoc(doc(db, "accounting_entries", state.editingAccountingId), payload);
    } else {
      await addDoc(collection(db, "accounting_entries"), { ...payload, createdAt: serverTimestamp() });
    }
    accountingDialog.close();
    toast(state.editingAccountingId ? "Operațiune actualizată." : "Operațiune adăugată.");
  } catch (error) {
    console.error("Could not save accounting entry.", error);
    showError(formError, error.message);
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteAccountingEntry(id) {
  const entry = state.accountingEntries.find((item) => item.id === id);
  if (!entry || !window.confirm(`Ștergi operațiunea nr. ${entry.nrCrt}? Această acțiune nu poate fi anulată.`)) return;
  try {
    await deleteDoc(doc(db, "accounting_entries", id));
    toast("Operațiune ștearsă.");
  } catch (error) {
    console.error("Could not delete accounting entry.", error);
    toast(`Nu s-a putut șterge operațiunea contabilă: ${error.message}`, true);
  }
}

function onAccountingAction(event) {
  const button = event.target.closest("[data-accounting-action]");
  if (!button) return;
  const entry = state.accountingEntries.find((item) => item.id === button.dataset.id);
  if (button.dataset.accountingAction === "edit" && entry) openAccountingDialog(entry);
  if (button.dataset.accountingAction === "delete") void deleteAccountingEntry(button.dataset.id);
}

function exportAccountingCsv() {
  const fields = ["Nr. crt.", "Data Operatiunii", "Document", "Explicatii", "Incasari Numerar", "Incasari Banca", "Plati Numerar", "Plati Banca", "incomeFiscalType", "expenseFiscalType", "deductibleLimitedAmount"];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = getFilteredAccountingEntries().map((entry) => [
    entry.nrCrt,
    entry.dataOperatiunii,
    entry.document,
    entry.explicatii,
    numberValue(entry.incasariNumerar).toFixed(2),
    numberValue(entry.incasariBanca).toFixed(2),
    numberValue(entry.platiNumerar).toFixed(2),
    numberValue(entry.platiBanca).toFixed(2),
    entry.incomeFiscalType ?? "unclassified",
    entry.expenseFiscalType ?? "unclassified",
    numberValue(entry.deductibleLimitedAmount).toFixed(2)
  ]);
  const csv = `\uFEFF${[fields, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `registru-incasari-plati-${state.accountingYear}-${state.accountingMonth}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Export CSV pregătit.");
}

function exportFiscalRegisterCsv() {
  const incomes = state.accountingEntries
    .filter((entry) => entry.incomeFiscalType === "taxable"
      && numberValue(entry.incasariNumerar) + numberValue(entry.incasariBanca) > 0
      && String(entry.dataOperatiunii ?? "").slice(0, 4) === state.accountingFiscalYear)
    .sort((a, b) => String(a.dataOperatiunii ?? "").localeCompare(String(b.dataOperatiunii ?? "")));
  const expenses = state.accountingEntries
    .filter((entry) => ["deductibleFull", "deductibleLimited"].includes(entry.expenseFiscalType)
      && numberValue(entry.platiNumerar) + numberValue(entry.platiBanca) > 0
      && String(entry.dataOperatiunii ?? "").slice(0, 4) === state.accountingFiscalYear)
    .sort((a, b) => String(a.dataOperatiunii ?? "").localeCompare(String(b.dataOperatiunii ?? "")));
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csvRows = [
    ["Tabel 1: Venituri Brute Impozabile"],
    ["Nr. Crt.", "Data", "Document (Tip/Nr.)", "Explicație / Felul operațiunii", "Suma (RON)"],
    ...incomes.map((entry, index) => [
      index + 1,
      accountingDateLabel(entry.dataOperatiunii),
      entry.document,
      entry.explicatii,
      (numberValue(entry.incasariNumerar) + numberValue(entry.incasariBanca)).toFixed(2)
    ]),
    [],
    ["Tabel 2: Cheltuieli Deductibile"],
    ["Nr. Crt.", "Data", "Document (Tip/Nr.)", "Felul cheltuielii", "Valoare Totală (RON)", "Deductibil Integral (RON)", "Deductibil Limitat (RON)"],
    ...expenses.map((entry, index) => {
      const total = numberValue(entry.platiNumerar) + numberValue(entry.platiBanca);
      return [
        index + 1,
        accountingDateLabel(entry.dataOperatiunii),
        entry.document,
        entry.explicatii,
        total.toFixed(2),
        (entry.expenseFiscalType === "deductibleFull" ? total : 0).toFixed(2),
        (entry.expenseFiscalType === "deductibleLimited"
          ? limitedDeductibleAmount(entry, total)
          : 0).toFixed(2)
      ];
    }),
    [],
    ["Determinarea Venitului Net"],
    ["Total Venit Brut (RON)", $("#fiscal-total-income").textContent],
    ["Total Cheltuieli Deductibile (RON)", $("#fiscal-total-expenses").textContent],
    ["Venit Net Anual (RON)", $("#fiscal-net-income").textContent]
  ];
  const csv = `\uFEFF${csvRows.map((row) => row.map(quote).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `registru-evidenta-fiscala-${state.accountingFiscalYear}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Exportul Registrului de Evidență Fiscală este pregătit.");
}

function printFiscalRegister() {
  document.body.classList.add("print-fiscal-register");
  window.addEventListener("afterprint", () => document.body.classList.remove("print-fiscal-register"), { once: true });
  window.print();
}

function setOblioStatus(message, isError = false) {
  const status = $("#oblio-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function renderOblioInvoices() {
  const empty = $("#oblio-invoices-empty");
  const table = $("#oblio-invoices-table-wrap");
  empty.hidden = state.oblioInvoices.length > 0;
  table.hidden = state.oblioInvoices.length === 0;
  if (!state.oblioInvoices.length) {
    empty.textContent = state.oblioInvoicesLoaded
      ? "Proxy-ul nu a returnat facturi."
      : "Facturile recente vor apărea aici după încărcare.";
  }
  $("#oblio-invoices-body").innerHTML = state.oblioInvoices.map((invoice) => `
    <tr>
      <td>${escapeHtml(invoice.number)}</td>
      <td>${escapeHtml(accountingDateLabel(invoice.date.slice(0, 10)) || invoice.date)}</td>
      <td>${escapeHtml(invoice.client || "—")}</td>
      <td>${accountingAmount(invoice.total)}</td>
      <td>${escapeHtml(invoice.status)}</td>
    </tr>
  `).join("");
}

function oblioBaseUrl() {
  const endpoint = state.oblioProxyUrl.replace(/\/+$/, "");
  if (!endpoint) {
    throw new Error("Proxy-ul Oblio nu este configurat. Adaugă VITE_OBLIO_PROXY_URL în GitHub Actions Variables și redeploy.");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("URL-ul proxy Oblio configurat nu este valid.");
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) {
    throw new Error("URL-ul proxy Oblio configurat nu este un endpoint HTTPS valid.");
  }
  return endpoint;
}

async function loadOblioInvoices() {
  const button = $("#oblio-load-invoices-button");
  button.disabled = true;
  setOblioStatus("Se încarcă facturile recente…");
  try {
    state.oblioInvoices = await listRecentInvoices(oblioBaseUrl());
    state.oblioInvoicesLoaded = true;
    renderOblioInvoices();
    setOblioStatus(`${state.oblioInvoices.length} facturi încărcate din proxy-ul Oblio.`);
  } catch (error) {
    console.error("Could not load Oblio invoices.", error);
    setOblioStatus(`Facturile nu au putut fi încărcate: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function syncPaidOblioInvoices() {
  const button = $("#oblio-sync-paid-button");
  button.disabled = true;
  setOblioStatus("Se verifică facturile achitate…");
  let synced = 0;
  try {
    const invoices = await listPaidInvoices(oblioBaseUrl());
    const paymentChannel = $("#oblio-payment-channel").value;
    const existingIds = new Set(state.accountingEntries
      .map((entry) => String(entry.sourceOblioInvoiceId ?? ""))
      .filter(Boolean));
    const nextNumbersByYear = new Map();
    for (const invoice of invoices) {
      if (existingIds.has(invoice.id)) continue;
      const entryId = `oblio-${encodeURIComponent(invoice.id)}`;
      const entryRef = doc(db, "accounting_entries", entryId);
      const existing = await getDoc(entryRef);
      if (existing.exists()) {
        existingIds.add(invoice.id);
        continue;
      }
      const operationDate = invoice.date.slice(0, 10);
      const [dateYear, dateMonth, dateDay] = operationDate.split("-").map(Number);
      const parsedDate = new Date(Date.UTC(dateYear, dateMonth - 1, dateDay));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(operationDate)
        || parsedDate.getUTCFullYear() !== dateYear
        || parsedDate.getUTCMonth() !== dateMonth - 1
        || parsedDate.getUTCDate() !== dateDay) {
        throw new Error(`Factura ${invoice.number} nu are o dată validă pentru înregistrare.`);
      }
      if (!Number.isFinite(invoice.total) || invoice.total <= 0) {
        throw new Error(`Factura ${invoice.number} nu are o valoare achitată pozitivă.`);
      }
      const year = operationDate.slice(0, 4);
      if (!nextNumbersByYear.has(year)) {
        const maximum = state.accountingEntries
          .filter((entry) => String(entry.dataOperatiunii ?? "").slice(0, 4) === year)
          .reduce((highest, entry) => Math.max(highest, numberValue(entry.nrCrt)), 0);
        nextNumbersByYear.set(year, maximum + 1);
      }
      const nrCrt = nextNumbersByYear.get(year);
      nextNumbersByYear.set(year, nrCrt + 1);
      const amountFields = paymentChannel === "numerar"
        ? { incasariNumerar: invoice.total, incasariBanca: 0 }
        : { incasariNumerar: 0, incasariBanca: invoice.total };
      await setDoc(entryRef, {
        nrCrt,
        dataOperatiunii: operationDate,
        document: `Factura Oblio ${invoice.number}`,
        explicatii: `Factură achitată de ${invoice.client || "client"}`,
        ...amountFields,
        platiNumerar: 0,
        platiBanca: 0,
        incomeFiscalType: "taxable",
        expenseFiscalType: "unclassified",
        deductibleLimitedAmount: 0,
        sourceOblioInvoiceId: invoice.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      existingIds.add(invoice.id);
      synced += 1;
    }
    setOblioStatus(synced
      ? `${synced} facturi achitate au fost adăugate în Registrul de Încasări și Plăți.`
      : "Nu există facturi achitate noi de sincronizat.");
    toast(synced
      ? `${synced} facturi Oblio sincronizate în registru.`
      : "Nu există facturi Oblio noi de sincronizat.");
  } catch (error) {
    console.error("Could not sync paid Oblio invoices.", error);
    setOblioStatus(synced
      ? `Sincronizarea s-a oprit după ${synced} facturi: ${error.message}`
      : `Facturile achitate nu au putut fi sincronizate: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function subscribeToInventory() {
  state.inventoryUnsubscribe?.();
  state.inventory = [];
  state.inventoryLoading = Boolean(state.activeEventId);
  renderInventory();
  if (!state.activeEventId) return;

  const inventoryQuery = query(
    collection(db, "inventory"),
    where("marketId", "==", state.activeEventId)
  );
  state.inventoryUnsubscribe = onSnapshot(
    inventoryQuery,
    (snapshot) => {
      state.inventory = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      state.inventoryLoading = false;
      renderInventory();
    },
    (error) => {
      state.inventoryLoading = false;
      renderInventory();
      console.error("Could not load inventory.", error);
      toast(`Nu s-a putut încărca stocul: ${error.message}`, true);
    }
  );
}

function getFilteredInventory() {
  const search = state.search.trim().toLocaleLowerCase();
  return state.inventory
    .filter((item) => state.selectedCategory === "All" || item.category === state.selectedCategory)
    .filter((item) => !search
      || String(item.sku ?? "").toLocaleLowerCase().includes(search)
      || String(item.name ?? "").toLocaleLowerCase().includes(search)
      || String(item.color ?? "").toLocaleLowerCase().includes(search))
    .sort((a, b) => {
      const first = state.sortBy === "sku" ? inventorySku(a) : a[state.sortBy] ?? "";
      const second = state.sortBy === "sku" ? inventorySku(b) : b[state.sortBy] ?? "";
      const comparison = typeof first === "number" && typeof second === "number"
        ? first - second
        : String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: "base" });
      return comparison * state.sortDirection;
    });
}

function inventorySku(item) {
  const sku = String(item.sku ?? "").trim();
  if (sku) return sku;
  return String(state.catalog.find((product) => product.id === item.productId)?.sku ?? "").trim();
}

function availableFor(item) {
  return Math.max(0, numberValue(item.totalQty) - numberValue(item.soldQty));
}

function availableClass(available, total) {
  if (available === 0) return "none";
  if (available <= Math.max(1, Math.ceil(total * 0.2))) return "low";
  return "";
}

function imageMarkup(item) {
  return item.imageBase64
    ? `<img src="data:image/jpeg;base64,${escapeHtml(item.imageBase64)}" alt="">`
    : "<span aria-hidden=\"true\">✿</span>";
}

function soldControls(item) {
  const sold = numberValue(item.soldQty);
  const total = numberValue(item.totalQty);
  const disabled = eventIsClosed(state.events.find((event) => event.id === state.activeEventId));
  return `<span class="sold-control">
    <button class="stepper-button" type="button" data-action="sold-minus" data-id="${escapeHtml(item.id)}" aria-label="Scade cu o unitate numărul vândut pentru ${escapeHtml(item.name)}" ${disabled || sold <= 0 ? "disabled" : ""}>−</button>
    <strong>${sold}</strong>
    <button class="stepper-button" type="button" data-action="sold-plus" data-id="${escapeHtml(item.id)}" aria-label="Adaugă o unitate vândută pentru ${escapeHtml(item.name)}" ${disabled || sold >= total ? "disabled" : ""}>+</button>
  </span>`;
}

function totalQuantityControls(item) {
  const total = numberValue(item.totalQty);
  const sold = numberValue(item.soldQty);
  const disabled = eventIsClosed(state.events.find((event) => event.id === state.activeEventId));
  return `<span class="sold-control">
    <button class="stepper-button" type="button" data-action="total-minus" data-id="${escapeHtml(item.id)}" aria-label="Scade cu o unitate stocul pentru ${escapeHtml(item.name)}" ${disabled || total <= sold ? "disabled" : ""}>−</button>
    <strong>${total}</strong>
    <button class="stepper-button" type="button" data-action="total-plus" data-id="${escapeHtml(item.id)}" aria-label="Adaugă o unitate în stoc pentru ${escapeHtml(item.name)}" ${disabled ? "disabled" : ""}>+</button>
  </span>`;
}

function productActions(item) {
  const disabled = eventIsClosed(state.events.find((event) => event.id === state.activeEventId));
  return `<span class="row-actions">
    <button class="text-button" type="button" data-action="edit" data-id="${escapeHtml(item.id)}" ${disabled ? "disabled" : ""}>Editează</button>
    <button class="text-button danger" type="button" data-action="delete" data-id="${escapeHtml(item.id)}" ${disabled ? "disabled" : ""}>Șterge</button>
  </span>`;
}

function renderSummary() {
  const totals = state.inventory.reduce((summary, item) => {
    const total = numberValue(item.totalQty);
    const sold = numberValue(item.soldQty);
    const price = numberValue(item.price);
    summary.prepared += total;
    summary.sold += sold;
    summary.revenue += price * sold;
    summary.profit += (price - numberValue(item.unitCost)) * sold;
    summary.potential += price * total;
    return summary;
  }, { prepared: 0, sold: 0, revenue: 0, profit: 0, potential: 0 });

  $("#summary-prepared").textContent = String(totals.prepared);
  $("#summary-sold").textContent = String(totals.sold);
  $("#summary-revenue").textContent = money.format(totals.revenue);
  $("#summary-profit").textContent = `Profit net ${money.format(totals.profit)}`;
  $("#summary-potential").textContent = money.format(totals.potential);
}

function renderCategoryPills() {
  const categories = [...new Set(state.inventory.map((item) => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const choices = ["All", ...categories];
  if (!choices.includes(state.selectedCategory)) state.selectedCategory = "All";
  $("#category-pills").innerHTML = choices.map((category) => `
    <button class="category-pill" type="button" data-category="${escapeHtml(category)}" aria-pressed="${state.selectedCategory === category}">${category === "All" ? "Toate" : escapeHtml(categoryLabel(category))}</button>
  `).join("");
}

function renderInventory() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  const marketClosed = eventIsClosed(event);
  const loading = $("#inventory-loading");
  const empty = $("#empty-state");
  const mobile = $("#mobile-inventory");
  const tableBody = $("#inventory-table-body");
  const filtered = getFilteredInventory();

  loading.hidden = !state.inventoryLoading;
  renderSummary();
  renderCategoryPills();
  $("#inventory-count").textContent = event
    ? `${filtered.length} ${filtered.length === 1 ? "produs" : "produse"}${filtered.length !== state.inventory.length ? ` afișate · ${state.inventory.length} în total` : ""}${marketClosed ? " · Târg încheiat (doar pentru citire)" : ""}`
    : "Alege sau creează un târg pentru a-i gestiona produsele.";

  const showEmpty = !state.inventoryLoading && (state.inventory.length === 0 || filtered.length === 0);
  empty.hidden = !showEmpty;
  if (state.inventory.length === 0) {
    $("#empty-title").textContent = event ? (marketClosed ? "Stocul târgului este închis" : "Stocul tău începe aici") : "Creează primul târg";
    $("#empty-description").textContent = event
      ? marketClosed ? "Târgul s-a încheiat. Produsele și vânzările înregistrate sunt păstrate în istoric." : "Adaugă primul produs pentru a-i urmări stocul și vânzările."
      : "Creează un târg sau o actualizare a magazinului înainte de a adăuga produse.";
    $("#empty-add-button").textContent = event ? "＋ Adaugă primul produs" : "＋ Eveniment nou";
    $("#empty-add-button").dataset.action = event ? "add" : "new-event";
    $("#empty-add-button").hidden = marketClosed;
  } else if (filtered.length === 0) {
    $("#empty-title").textContent = "Nu s-au găsit produse";
    $("#empty-description").textContent = "Încearcă altă căutare sau selectează altă categorie.";
    $("#empty-add-button").hidden = true;
  } else {
    $("#empty-add-button").hidden = false;
  }

  if (state.inventory.length === 0 && event) $("#empty-add-button").hidden = false;
  if (state.inventory.length > 0 && filtered.length > 0) $("#empty-add-button").hidden = false;
  if (state.inventoryLoading) empty.hidden = true;

  mobile.innerHTML = filtered.map((item) => {
    const available = availableFor(item);
    const total = numberValue(item.totalQty);
    const sold = numberValue(item.soldQty);
    const revenue = numberValue(item.price) * sold;
    const potential = numberValue(item.price) * total;
    return `<article class="product-card">
      <div class="product-card-top">
        <div class="product-thumb">${imageMarkup(item)}</div>
        <div class="product-card-title">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="sku-badge">${escapeHtml(item.sku)}</span>
          ${item.color ? `<span class="product-color-label">${escapeHtml(item.color)}</span>` : ""}
        </div>
        <span class="product-card-category">${escapeHtml(item.category)}</span>
      </div>
      <div class="product-card-price">${money.format(numberValue(item.price))}</div>
      <div class="product-card-stats">
        <div class="product-stat"><span>Disponibil</span><strong><span class="available-badge ${availableClass(available, total)}">${available}</span></strong></div>
        <div class="product-stat"><span>Încasări</span><strong>${money.format(revenue)}</strong></div>
        <div class="product-stat"><span>Valoare totală</span><strong>${money.format(potential)}</strong></div>
      </div>
      <div class="product-card-quantities">
        <div class="product-quantity-control"><span>În stoc</span>${totalQuantityControls(item)}</div>
        <div class="product-quantity-control"><span>Vândut</span>${soldControls(item)}</div>
      </div>
      <div class="product-card-bottom">
        <span class="sold-label">${sold} vândute din ${total}</span>
        <span class="mobile-card-actions">${productActions(item)}</span>
      </div>
    </article>`;
  }).join("");

  tableBody.innerHTML = filtered.map((item) => {
    const available = availableFor(item);
    const total = numberValue(item.totalQty);
    const sold = numberValue(item.soldQty);
    return `<tr>
      <td><div class="product-thumb">${imageMarkup(item)}</div></td>
      <td><span class="sku-badge">${escapeHtml(item.sku)}</span></td>
      <td class="product-name-cell" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}${item.color ? `<small class="product-color-label">${escapeHtml(item.color)}</small>` : ""}</td>
      <td>${escapeHtml(categoryLabel(item.category))}</td>
      <td>${money.format(numberValue(item.price))}</td>
      <td>${totalQuantityControls(item)}</td>
      <td><span class="available-badge ${availableClass(available, total)}">${available}</span></td>
      <td>${soldControls(item)}</td>
      <td>${money.format(numberValue(item.price) * sold)}</td>
      <td>${money.format(numberValue(item.price) * total)}</td>
      <td>${productActions(item)}</td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".sort-button").forEach((button) => {
    const active = button.dataset.sort === state.sortBy;
    button.querySelector("span").textContent = active ? (state.sortDirection === 1 ? "↑" : "↓") : "";
    button.setAttribute("aria-label", `${button.textContent.trim()}${active ? (state.sortDirection === 1 ? ", crescător" : ", descrescător") : ""}`);
  });
}

function updateLivePreview() {
  const form = inventoryForm.elements;
  const total = Math.max(0, numberValue(form.totalQty.value));
  const sold = Math.min(total, Math.max(0, numberValue(form.soldQty.value)));
  const price = Math.max(0, numberValue(form.price.value));
  $("#preview-available").textContent = String(total - sold);
  $("#preview-total-price").textContent = money.format(total * price);
}

function resetInventoryForm(item = null) {
  inventoryForm.reset();
  state.editingId = item?.id ?? null;
  state.imageBase64 = item?.imageBase64 ?? "";
  $("#inventory-form-title").textContent = item ? "Editează produsul" : "Adaugă produs";
  $("#inventory-form-eyebrow").textContent = item ? "ACTUALIZEAZĂ DETALIILE PRODUSULUI" : "DETALII PRODUS";
  $("#save-inventory-button").textContent = item ? "Salvează modificările" : "Salvează produsul";
  clearError($("#inventory-form-error"));

  if (item) {
    inventoryForm.elements.sku.value = item.sku ?? "";
    inventoryForm.elements.name.value = item.name ?? "";
    inventoryForm.elements.category.value = item.category ?? "Other";
    inventoryForm.elements.price.value = numberValue(item.price);
    inventoryForm.elements.unitCost.value = numberValue(item.unitCost);
    inventoryForm.elements.totalQty.value = numberValue(item.totalQty);
    inventoryForm.elements.soldQty.value = numberValue(item.soldQty);
    inventoryForm.elements.notes.value = item.notes ?? "";
  }
  $("#image-input").value = "";
  renderImagePreview();
  updateLivePreview();
}

function renderImagePreview() {
  const preview = $("#image-preview");
  preview.innerHTML = state.imageBase64
    ? `<img src="data:image/jpeg;base64,${escapeHtml(state.imageBase64)}" alt="Product thumbnail preview">`
    : "<span>Previzualizare imagine</span>";
}

function openInventoryDialog(item = null) {
  const event = state.events.find((current) => current.id === state.activeEventId);
  if (!event || eventIsClosed(event)) {
    toast(event ? "Târgul este încheiat, iar stocul poate fi doar consultat." : "Creează sau selectează un târg înainte de a adăuga produse.", true);
    return;
  }
  if (!item) {
    state.pickerSearch = "";
    state.pickerCategory = "All";
    $("#product-picker-search").value = "";
    $("#product-picker-category").value = "All";
    renderProductPicker();
    productPickerDialog.showModal();
    return;
  }
  resetInventoryForm(item);
  inventoryDialog.showModal();
}

function openProductQuantityDialog(product) {
  const event = state.events.find((current) => current.id === state.activeEventId);
  if (!event || eventIsClosed(event)) {
    toast(event ? "Târgul este încheiat, iar stocul poate fi doar consultat." : "Creează sau selectează un târg înainte de a adăuga produse.", true);
    return;
  }
  const variants = missingCatalogVariants(product);
  if (!variants.length) {
    toast("Acest articol există deja în târgul selectat.", true);
    return;
  }
  state.selectedCatalogProductId = product.id;
  $("#selected-product-name").textContent = product.name;
  $("#selected-product-details").textContent = `${product.sku} · ${categoryLabel(product.category)} · ${money.format(numberValue(product.price))}`;
  $("#product-quantity-form").reset();
  $("#product-variant-stock-list").innerHTML = variants.map((variant) => `
    <label class="market-variant-stock" data-market-variant-id="${escapeHtml(variant.id)}">
      <span class="product-thumb">${imageMarkup({ imageBase64: variant.imageBase64 })}</span>
      <span class="market-variant-copy"><strong>${escapeHtml(variant.color)}</strong><small>Cantitatea inițială pentru târg</small></span>
      <input data-market-variant-quantity type="number" min="0" step="1" inputmode="numeric" value="0" aria-label="${escapeHtml(variant.color)} — cantitate inițială" required>
    </label>
  `).join("");
  $("#product-quantity-error").hidden = true;
  productQuantityDialog.showModal();
}

function openCatalogItemDialog(product = null) {
  $("#catalog-item-form").reset();
  state.editingCatalogId = product?.id ?? null;
  state.catalogVariants = product
    ? catalogVariants(product).map((variant) => ({ ...variant }))
    : [{ id: createVariantId(), color: "Standard", imageBase64: "" }];
  $("#catalog-item-title").textContent = product ? "Editează articolul" : "Adaugă articol";
  $("#catalog-item-eyebrow").textContent = product ? "ACTUALIZEAZĂ CATALOGUL" : "CATALOG PRODUSE";
  $("#save-catalog-item-button").textContent = product ? "Salvează modificările" : "Salvează articolul";
  $("#catalog-item-error").hidden = true;
  renderCategoryControls();
  if (product) {
    $("#catalog-item-form").elements.sku.value = product.sku ?? "";
    $("#catalog-item-form").elements.name.value = product.name ?? "";
    $("#catalog-item-form").elements.category.value = product.category ?? state.categories[0] ?? "";
    $("#catalog-item-form").elements.price.value = numberValue(product.price);
    $("#catalog-item-form").elements.unitCost.value = numberValue(product.unitCost);
    $("#catalog-item-form").elements.notes.value = product.notes ?? "";
  } else {
    $("#catalog-item-form").elements.sku.value = nextCatalogSku(state.catalog);
  }
  renderCatalogVariants();
  catalogItemDialog.showModal();
}

async function handleCatalogItemSubmit(event) {
  event.preventDefault();
  const form = $("#catalog-item-form");
  const button = $("#save-catalog-item-button");
  const formError = $("#catalog-item-error");
  clearError(formError);
  button.disabled = true;
  try {
    const formData = new FormData(form);
    const sku = String(formData.get("sku")).trim();
    const duplicate = state.catalog.find((product) =>
      product.id !== state.editingCatalogId
      && String(product.sku ?? "").trim().toLocaleLowerCase() === sku.toLocaleLowerCase()
    );
    if (duplicate) throw new Error(`Codul SKU „${sku}” este deja folosit de articolul „${duplicate.name}”.`);

    const variants = [...form.querySelectorAll("[data-variant-row]")].map((row) => ({
      id: row.dataset.variantId,
      color: row.querySelector("[data-variant-color]").value.trim(),
      imageBase64: state.catalogVariants.find((variant) => variant.id === row.dataset.variantId)?.imageBase64 ?? ""
    }));
    if (!variants.length || variants.length > 12) throw new Error("Un articol trebuie să aibă între 1 și 12 variante de culoare.");
    if (variants.some((variant) => !variant.color)) throw new Error("Fiecare variantă de culoare trebuie să aibă un nume.");
    if (new Set(variants.map((variant) => variant.color.toLocaleLowerCase())).size !== variants.length) {
      throw new Error("Numele fiecărei variante de culoare trebuie să fie unic.");
    }

    const product = {
      sku,
      name: String(formData.get("name")).trim(),
      category: String(formData.get("category")),
      imageBase64: variants[0].imageBase64,
      variants,
      price: Math.max(0, numberValue(formData.get("price"))),
      unitCost: Math.max(0, numberValue(formData.get("unitCost"))),
      notes: String(formData.get("notes") ?? "").trim(),
      updatedAt: serverTimestamp()
    };
    if (state.editingCatalogId) {
      await updateDoc(doc(db, "products", state.editingCatalogId), product);
      toast("Catalog actualizat. Prețurile târgurilor existente nu au fost modificate.");
    } else {
      await addDoc(collection(db, "products"), { ...product, createdAt: serverTimestamp() });
      toast("Articol adăugat în catalog.");
    }
    catalogItemDialog.close();
  } catch (error) {
    console.error("Could not save catalog item.", error);
    showError(formError, error.message);
  } finally {
    button.disabled = false;
  }
}

async function deleteCatalogItem(id) {
  const product = state.catalog.find((item) => item.id === id);
  if (!product || !window.confirm(`Elimini articolul „${product.name}” din catalog? Înregistrările târgurilor existente vor rămâne neschimbate.`)) return;
  try {
    await deleteDoc(doc(db, "products", id));
    toast("Articol șters din catalog; înregistrările târgurilor anterioare au fost păstrate.");
  } catch (error) {
    console.error("Could not remove catalog item.", error);
    toast(`Nu s-a putut șterge articolul din catalog: ${error.message}`, true);
  }
}

async function handleProductQuantitySubmit(event) {
  event.preventDefault();
  const product = state.catalog.find((item) => item.id === state.selectedCatalogProductId);
  const market = state.events.find((item) => item.id === state.activeEventId);
  if (!product || !market || eventIsClosed(market)) return;
  const error = $("#product-quantity-error");
  clearError(error);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const batch = writeBatch(db);
    const rows = [...$("#product-variant-stock-list").querySelectorAll("[data-market-variant-id]")];
    if (!rows.length) throw new Error("Nu există variante de culoare disponibile pentru adăugare.");
    rows.forEach((row) => {
      const variant = catalogVariants(product).find((item) => item.id === row.dataset.marketVariantId);
      if (!variant) throw new Error("Varianta de culoare nu a fost găsită. Închide această fereastră și încearcă din nou.");
      const totalQty = Number(row.querySelector("[data-market-variant-quantity]").value);
      if (!Number.isInteger(totalQty) || totalQty < 0) throw new Error("Cantitățile variantelor trebuie să fie numere întregi egale cu zero sau mai mari.");
      batch.set(doc(collection(db, "inventory")), {
        marketId: state.activeEventId,
        productId: product.id,
        variantId: variant.id,
        color: variant.color,
        sku: product.sku,
        name: product.name,
        category: product.category,
        imageBase64: variant.imageBase64,
        price: numberValue(product.price),
        unitCost: numberValue(product.unitCost),
        totalQty,
        soldQty: 0,
        notes: String(event.currentTarget.elements.notes.value ?? "").trim(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    productQuantityDialog.close();
    productPickerDialog.close();
    toast(`${rows.length} ${rows.length === 1 ? "variantă de culoare adăugată" : "variante de culoare adăugate"} la acest târg, inclusiv variantele fără stoc.`);
  } catch (error) {
    console.error("Could not add item to market.", error);
    showError($("#product-quantity-error"), error.message);
  } finally {
    submitButton.disabled = false;
  }
}

function openCategoryDialog() {
  state.editingCategoryId = null;
  $("#category-form").reset();
  $("#category-input-label").textContent = "Categorie nouă";
  $("#save-category-button").textContent = "Adaugă categoria";
  $("#cancel-category-edit").hidden = true;
  clearError($("#category-form-error"));
  renderCategoryList();
  categoryDialog.showModal();
}

function editCategory(id) {
  const category = state.categoryRecords.find((item) => item.id === id);
  if (!category) return;
  state.editingCategoryId = id;
  $("#category-name-input").value = category.name;
  $("#category-input-label").textContent = "Redenumește categoria";
  $("#save-category-button").textContent = "Salvează categoria";
  $("#cancel-category-edit").hidden = false;
  clearError($("#category-form-error"));
  $("#category-name-input").focus();
}

async function handleCategorySubmit(event) {
  event.preventDefault();
  const name = $("#category-name-input").value.trim();
  const formError = $("#category-form-error");
  clearError(formError);
  const duplicate = state.categories.find((category) =>
    category.toLocaleLowerCase() === name.toLocaleLowerCase()
    && category !== state.categoryRecords.find((item) => item.id === state.editingCategoryId)?.name
  );
  if (duplicate) {
    showError(formError, `Categoria „${duplicate}” există deja.`);
    return;
  }

  const button = $("#save-category-button");
  button.disabled = true;
  try {
    if (state.editingCategoryId) {
      const previousName = state.categoryRecords.find((item) => item.id === state.editingCategoryId)?.name;
      const products = state.catalog.filter((product) => product.category === previousName);
      for (let start = 0; start < products.length; start += 450) {
        const batch = writeBatch(db);
        if (start === 0) {
          batch.update(doc(db, "categories", state.editingCategoryId), { name });
        }
        products.slice(start, start + 450).forEach((product) => {
          batch.update(doc(db, "products", product.id), { category: name, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      if (!products.length) {
        await updateDoc(doc(db, "categories", state.editingCategoryId), { name });
      }
      toast(`Categoria a fost redenumită în ${name}. Târgurile existente nu au fost modificate.`);
    } else {
      await setDoc(doc(db, "categories", categoryDocumentId(name)), {
        name,
        createdAt: serverTimestamp()
      });
      toast(`Categoria „${name}” a fost adăugată.`);
    }

    state.editingCategoryId = null;
    $("#category-form").reset();
    $("#category-input-label").textContent = "Categorie nouă";
    $("#save-category-button").textContent = "Adaugă categoria";
    $("#cancel-category-edit").hidden = true;
  } catch (error) {
    console.error("Could not save category.", error);
    showError(formError, error.message);
  } finally {
    button.disabled = false;
  }
}

async function deleteCategory(id) {
  const category = state.categoryRecords.find((item) => item.id === id);
  if (!category) return;
  if (state.catalog.some((product) => product.category === category.name)) {
    toast("Reasignează produsele din catalog înainte de a șterge această categorie.", true);
    return;
  }
  if (!window.confirm(`Elimini categoria „${category.name}” din listă? Înregistrările târgurilor anterioare o vor păstra.`)) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    toast(`Categoria „${category.name}” a fost ștearsă. Înregistrările târgurilor au fost păstrate.`);
  } catch (error) {
    console.error("Could not remove category.", error);
    toast(`Nu s-a putut șterge categoria: ${error.message}`, true);
  }
}

function openNewEventDialog() {
  eventForm.reset();
  const today = new Date();
  const todayValue = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  eventForm.elements.startDate.value = todayValue;
  eventForm.elements.endDate.value = todayValue;
  clearError($("#event-form-error"));
  eventDialog.showModal();
}

function openSettingsDialog() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  settingsForm.reset();
  clearError($("#settings-form-error"));
  $("#settings-event-hint").textContent = event
    ? "Editează târgul sau șterge-l împreună cu stocul aferent."
    : "Creează sau selectează un târg pentru a-l gestiona.";
  $("#settings-account-email").textContent = state.user?.email ?? "Autentificat";

  $("#selected-event-settings").querySelectorAll("input, select").forEach((field) => {
    field.disabled = !event;
  });
  $("#delete-event-button").disabled = !event;
  $("#save-settings-button").disabled = !event;
  if (event) {
    settingsForm.elements.name.value = event.name ?? "";
    settingsForm.elements.type.value = event.type ?? "Market";
    settingsForm.elements.startDate.value = event.startDate ?? event.date ?? "";
    settingsForm.elements.endDate.value = event.endDate ?? event.date ?? "";
    settingsForm.elements.location.value = event.location ?? "";
    settingsForm.elements.organizer.value = event.organizer ?? "";
    settingsForm.elements.edition.value = event.edition ?? "";
  }
  settingsDialog.showModal();
}

function openImportDialog() {
  const today = new Date();
  const todayValue = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  $("#import-event-start-date").value = todayValue;
  $("#import-event-end-date").value = todayValue;
  $("#import-event-name").value = "";
  $("#import-event-location").value = "";
  $("#import-event-organizer").value = "";
  $("#import-event-edition").value = "";
  $("#import-event-type").value = "Market";
  $("#import-csv-file").value = "";
  clearError($("#import-form-error"));
  importDialog.showModal();
}

function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (insideQuotes) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      insideQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (insideQuotes) throw new Error("Fișierul CSV conține un câmp între ghilimele care nu a fost închis.");
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  if (rows.length < 2) throw new Error("Fișierul CSV trebuie să conțină un rând de antet și cel puțin un articol.");

  return rows;
}

function normalizeCsvHeader(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseCsvQuantity(value, fieldName, rowNumber) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 0;
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Rândul ${rowNumber}: ${fieldName} trebuie să fie un număr întreg egal cu zero sau mai mare.`);
  }
  return number;
}

function parseCsvPrice(value, fieldName, rowNumber, optional = false) {
  const normalized = String(value ?? "").trim();
  if (!normalized && optional) return 0;
  if (!normalized) throw new Error(`Rândul ${rowNumber}: câmpul ${fieldName} nu poate fi gol.`);
  let numberText = normalized.replace(/[^\d,.-]/g, "");
  if (numberText.includes(",") && numberText.includes(".")) {
    const decimalSeparator = numberText.lastIndexOf(",") > numberText.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    numberText = numberText.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") numberText = numberText.replace(",", ".");
  } else if (numberText.includes(",")) {
    numberText = numberText.replace(",", ".");
  }
  const number = Number(numberText);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Rândul ${rowNumber}: ${fieldName} trebuie să fie un număr egal cu zero sau mai mare.`);
  }
  return number;
}

function inventoryFromCsv(text) {
  const [headers, ...rows] = parseCsv(text);
  const columns = new Map(headers.map((header, index) => [normalizeCsvHeader(header), index]));
  const required = ["sku", "productname", "category", "price", "totalqty"];
  const missing = required.filter((header) => !columns.has(header));
  if (missing.length) {
    const labels = {
      sku: "SKU",
      productname: "Product Name",
      category: "Category",
      price: "Price",
      totalqty: "Total Qty"
    };
    throw new Error(`Lipsește ${missing.length === 1 ? "coloana obligatorie" : "coloanele obligatorii"} din CSV: ${missing.map((header) => labels[header]).join(", ")}.`);
  }

  const read = (cells, column) => {
    const index = columns.get(column);
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  return rows.map((cells, index) => {
    const rowNumber = index + 2;
    const sku = read(cells, "sku");
    const name = read(cells, "productname");
    const category = read(cells, "category");
    if (!sku || !name || !category) {
      throw new Error(`Rândul ${rowNumber}: câmpurile SKU, Product Name și Category nu pot fi goale.`);
    }
    const totalQty = parseCsvQuantity(read(cells, "totalqty"), "Total Qty", rowNumber);
    const soldQty = parseCsvQuantity(read(cells, "soldqty"), "Sold Qty", rowNumber);
    if (soldQty > totalQty) {
      throw new Error(`Rândul ${rowNumber}: Sold Qty nu poate fi mai mare decât Total Qty.`);
    }
    return {
      sku,
      name,
      color: read(cells, "color") || "Standard",
      category,
      price: parseCsvPrice(read(cells, "price"), "Price", rowNumber),
      unitCost: parseCsvPrice(read(cells, "unitcost"), "Unit Cost", rowNumber, true),
      totalQty,
      soldQty,
      notes: read(cells, "notes")
    };
  });
}

async function importMarketFromCsv() {
  const button = $("#import-csv-button");
  const error = $("#import-form-error");
  clearError(error);
  const file = $("#import-csv-file").files?.[0];
  const name = $("#import-event-name").value.trim();
  const startDate = $("#import-event-start-date").value;
  const endDate = $("#import-event-end-date").value;

  if (!file) {
    showError(error, "Alege fișierul CSV pe care dorești să îl imporți.");
    return;
  }
  if (!name || !startDate || !endDate) {
    showError(error, "Introdu denumirea târgului, data de început și data de sfârșit.");
    return;
  }
  if (endDate < startDate) {
    showError(error, "Data de sfârșit trebuie să fie aceeași sau ulterioară datei de început.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showError(error, "Fișierul CSV depășește 5 MB. Exportă sau împarte un fișier de stoc mai mic.");
    return;
  }

  button.disabled = true;
  button.textContent = "Se importă…";
  let eventCreated = false;
  let importedCount = 0;
  try {
    const products = inventoryFromCsv(await file.text());
    const seenVariants = new Set();
    products.forEach((product) => {
      const variantKey = `${product.sku.toLocaleLowerCase()}\u0000${product.color.toLocaleLowerCase()}`;
      if (seenVariants.has(variantKey)) throw new Error(`Fișierul CSV conține culoarea „${product.color}” de mai multe ori pentru SKU-ul „${product.sku}”.`);
      seenVariants.add(variantKey);
    });

    const importedProducts = new Map();
    const existingProducts = new Map(state.catalog.map((product) => [
      String(product.sku ?? "").trim().toLocaleLowerCase(),
      product
    ]));
    products.forEach((product) => {
      const skuKey = product.sku.toLocaleLowerCase();
      let catalogItem = importedProducts.get(skuKey);
      if (!catalogItem) {
        const existing = existingProducts.get(skuKey) ?? null;
        catalogItem = {
          product,
          existing,
          productId: existing?.id ?? doc(collection(db, "products")).id,
          variants: existing ? catalogVariants(existing) : [],
          shouldCreateCatalogItem: !existing,
          shouldUpdateCatalogItem: false
        };
        importedProducts.set(skuKey, catalogItem);
      }
      let variant = catalogItem.variants.find((item) => item.color.toLocaleLowerCase() === product.color.toLocaleLowerCase());
      if (!variant) {
        variant = {
          id: createVariantId(),
          color: product.color,
          imageBase64: "",
          quantity: product.totalQty
        };
        catalogItem.variants.push(variant);
        catalogItem.shouldUpdateCatalogItem = Boolean(catalogItem.existing);
      }
      product.variantId = variant.id;
    });

    const missingCategories = [...new Set(products.map((product) => product.category))]
      .filter((name) => !state.categoryRecords.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase()));
    for (let start = 0; start < missingCategories.length; start += 450) {
      const batch = writeBatch(db);
      missingCategories.slice(start, start + 450).forEach((category) => {
        batch.set(doc(db, "categories", categoryDocumentId(category)), {
          name: category,
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();
    }

    const eventRef = doc(collection(db, "events"));
    const eventData = {
      name,
      type: $("#import-event-type").value,
      startDate,
      endDate,
      location: $("#import-event-location").value.trim(),
      organizer: $("#import-event-organizer").value.trim(),
      edition: $("#import-event-edition").value.trim(),
      status: "open",
      cashIncome: 0,
      bankIncome: 0,
      totalItemsSold: 0,
      createdAt: serverTimestamp()
    };

    for (let start = 0; start < products.length || start === 0; start += 200) {
      const batch = writeBatch(db);
      if (start === 0) batch.set(eventRef, eventData);
      if (start === 0) {
        importedProducts.forEach((catalogItem) => {
          if (catalogItem.shouldCreateCatalogItem) {
            batch.set(doc(db, "products", catalogItem.productId), {
              sku: catalogItem.product.sku,
              name: catalogItem.product.name,
              category: catalogItem.product.category,
              imageBase64: catalogItem.variants[0]?.imageBase64 ?? "",
              variants: catalogItem.variants,
              price: catalogItem.product.price,
              unitCost: catalogItem.product.unitCost,
              notes: catalogItem.product.notes,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          } else if (catalogItem.shouldUpdateCatalogItem) {
            const existing = catalogItem.existing;
            batch.update(doc(db, "products", catalogItem.productId), {
              sku: existing.sku,
              name: existing.name,
              category: existing.category,
              imageBase64: catalogItem.variants[0]?.imageBase64 ?? existing.imageBase64 ?? "",
              variants: catalogItem.variants,
              price: numberValue(existing.price),
              unitCost: numberValue(existing.unitCost),
              notes: existing.notes ?? "",
              updatedAt: serverTimestamp()
            });
          }
        });
      }
      products.slice(start, start + 200).forEach((product) => {
        const catalogItem = importedProducts.get(product.sku.toLocaleLowerCase());
        batch.set(doc(collection(db, "inventory")), {
          marketId: eventRef.id,
          productId: catalogItem.productId,
          color: product.color,
          ...product,
          imageBase64: "",
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
      eventCreated = true;
      importedCount += products.slice(start, start + 200).length;
    }

    state.activeEventId = eventRef.id;
    importDialog.close();
    toast(`S-a importat „${name}” cu ${products.length} ${products.length === 1 ? "produs" : "produse"}.`);
  } catch (error) {
    console.error("Could not import market from CSV.", error);
    const partialImportWarning = eventCreated
      ? ` Târgul a fost salvat împreună cu ${importedCount} ${importedCount === 1 ? "produs" : "produse"}; verifică lista târgurilor înainte de a încerca din nou.`
      : "";
    showError($("#import-form-error"), `${error.message}${partialImportWarning}`);
  } finally {
    button.disabled = false;
    button.textContent = "Importă târgul și produsele";
  }
}

async function compressImage(file) {
  let bitmap;
  let objectUrl;
  try {
    if ("createImageBitmap" in window) {
      bitmap = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Imaginea nu a putut fi deschisă."));
        image.src = objectUrl;
      });
    }

    const scale = Math.min(1, 300 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browserul nu a putut pregăti imaginea.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
  } finally {
    bitmap?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function createEvent(eventData) {
  let products = [];
  if (eventData.copyCatalog && state.events.length) {
    const snapshot = await getDocs(query(
      collection(db, "inventory"),
      where("marketId", "==", state.events[0].id)
    ));
    products = snapshot.docs.map((item) => item.data());
  }

  const eventRef = doc(collection(db, "events"));
  await setDoc(eventRef, {
    name: eventData.name.trim(),
    type: eventData.type,
    startDate: eventData.startDate,
    endDate: eventData.endDate,
    location: eventData.location.trim(),
    organizer: eventData.organizer.trim(),
    edition: eventData.edition.trim(),
    status: "open",
    cashIncome: 0,
    bankIncome: 0,
    totalItemsSold: 0,
    createdAt: serverTimestamp()
  });

  if (products.length) {
    for (let start = 0; start < products.length; start += 450) {
      const batch = writeBatch(db);
      products.slice(start, start + 450).forEach((product) => {
        const productRef = doc(collection(db, "inventory"));
        batch.set(productRef, {
          marketId: eventRef.id,
          ...(product.productId ? { productId: product.productId } : {}),
          ...(product.variantId ? { variantId: product.variantId } : {}),
          ...(product.color ? { color: product.color } : {}),
          sku: product.sku ?? "",
          name: product.name ?? "",
          category: product.category ?? "Other",
          imageBase64: product.imageBase64 ?? "",
          price: numberValue(product.price),
          unitCost: numberValue(product.unitCost),
          totalQty: 0,
          soldQty: 0,
          notes: product.notes ?? "",
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }
  }
  return products.length;
}

async function handleEventSubmit(event) {
  event.preventDefault();
  const submitButton = eventForm.querySelector('button[type="submit"]');
  const error = $("#event-form-error");
  clearError(error);
  submitButton.disabled = true;
  try {
    const formData = new FormData(eventForm);
    if (formData.get("endDate") < formData.get("startDate")) {
      throw new Error("Data de sfârșit trebuie să fie aceeași sau ulterioară datei de început.");
    }
    const copiedCount = await createEvent({
      name: formData.get("name"),
      type: formData.get("type"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      location: formData.get("location") ?? "",
      organizer: formData.get("organizer") ?? "",
      edition: formData.get("edition") ?? "",
      copyCatalog: formData.has("copyCatalog")
    });
    eventDialog.close();
    toast(copiedCount
      ? `Event created and ${copiedCount} catalog ${copiedCount === 1 ? "item copied" : "items copied"}.`
      : "Event created.");
  } catch (error) {
    console.error("Could not create event.", error);
    showError($("#event-form-error"), error.message);
  } finally {
    submitButton.disabled = false;
  }
}

function openMarketCloseDialog() {
  const market = state.events.find((event) => event.id === state.activeEventId);
  if (!market || market.type !== "Market" || eventIsClosed(market)) return;
  $("#market-close-form").reset();
  $("#market-close-name").textContent = market.name;
  $("#market-close-sold-count").textContent = String(soldQuantityForMarket(state.inventory));
  clearError($("#market-close-error"));
  marketCloseDialog.showModal();
}

async function saveMarketSoldTotal(market) {
  const snapshot = await getDocsFromServer(query(
    collection(db, "inventory"),
    where("marketId", "==", market.id)
  ));
  const totalItemsSold = soldQuantityForMarket(snapshot.docs.map((item) => item.data()));
  await updateDoc(doc(db, "events", market.id), { totalItemsSold });
  state.marketHistorySoldTotals[market.id] = totalItemsSold;
  state.marketHistoryHasInventoryTotals = true;
  renderMarketHistory();
  return totalItemsSold;
}

async function handleMarketCloseSubmit(event) {
  event.preventDefault();
  const market = state.events.find((item) => item.id === state.activeEventId);
  const button = $("#confirm-market-close-button");
  const errorElement = $("#market-close-error");
  clearError(errorElement);
  if (!market || market.type !== "Market" || eventIsClosed(market)) return;
  if (!navigator.onLine) {
    showError(errorElement, "Conectează-te la internet înainte de a încheia târgul pentru a putea verifica vânzările finale.");
    return;
  }
  button.disabled = true;
  try {
    const formData = new FormData($("#market-close-form"));
    const cashIncome = Number(formData.get("cashIncome"));
    const bankIncome = Number(formData.get("bankIncome"));
    if (![cashIncome, bankIncome].every((amount) => Number.isFinite(amount) && amount >= 0)) {
      throw new Error("Introdu sume valide, pozitive sau zero, pentru încasările în numerar și bancă.");
    }

    const inventorySnapshot = await getDocsFromServer(query(
      collection(db, "inventory"),
      where("marketId", "==", market.id)
    ));
    const totalItemsSold = soldQuantityForMarket(inventorySnapshot.docs.map((item) => item.data()));
    await updateDoc(doc(db, "events", market.id), {
      status: "closed",
      cashIncome,
      bankIncome,
      totalItemsSold,
      closedAt: serverTimestamp()
    });

    try {
      await saveMarketSoldTotal(market);
    } catch (refreshError) {
      console.error("Could not refresh final market sold total.", refreshError);
      toast(`Târgul a fost încheiat, dar totalul final al produselor vândute nu s-a putut actualiza: ${refreshError.message}`, true);
    }
    marketCloseDialog.close();
    toast(`Târg încheiat. Încasări înregistrate: ${money.format(cashIncome + bankIncome)}.`);
  } catch (error) {
    console.error("Could not close market.", error);
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}

async function refreshMarketSoldTotal() {
  const market = state.events.find((event) => event.id === state.activeEventId);
  if (!market || !eventIsClosed(market)) return;
  const button = $("#refresh-market-total-button");
  button.disabled = true;
  try {
    const total = await saveMarketSoldTotal(market);
    toast(`Totalul final al produselor vândute a fost actualizat la ${total}.`);
  } catch (error) {
    console.error("Could not refresh market sold total.", error);
    toast(`Nu s-a putut actualiza totalul vânzărilor târgului: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const activeEvent = state.events.find((item) => item.id === state.activeEventId);
  if (!activeEvent) return;

  const saveButton = $("#save-settings-button");
  const error = $("#settings-form-error");
  clearError(error);
  saveButton.disabled = true;
  try {
    const formData = new FormData(settingsForm);
    const startDate = String(formData.get("startDate"));
    const endDate = String(formData.get("endDate"));
    if (endDate < startDate) {
      throw new Error("Data de sfârșit trebuie să fie aceeași sau ulterioară datei de început.");
    }

    await updateDoc(doc(db, "events", activeEvent.id), {
      name: String(formData.get("name")).trim(),
      type: String(formData.get("type")),
      startDate,
      endDate,
      location: String(formData.get("location") ?? "").trim(),
      organizer: String(formData.get("organizer") ?? "").trim(),
      edition: String(formData.get("edition") ?? "").trim()
    });
    settingsDialog.close();
    toast("Setările târgului au fost salvate.");
  } catch (error) {
    console.error("Could not save event settings.", error);
    showError($("#settings-form-error"), error.message);
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteActiveEvent() {
  const activeEvent = state.events.find((item) => item.id === state.activeEventId);
  if (!activeEvent) return;
  if (!navigator.onLine) {
    showError($("#settings-form-error"), "Conectează-te la internet înainte de a șterge târgul, pentru a putea elimina în siguranță întregul său stoc.");
    return;
  }

  const deleteButton = $("#delete-event-button");
  clearError($("#settings-form-error"));
  if (!window.confirm(`Ștergi definitiv târgul „${activeEvent.name}” și toate produsele și vânzările sale? Acțiunea nu poate fi anulată.`)) return;

  deleteButton.disabled = true;
  try {
    const products = await getDocsFromServer(query(
      collection(db, "inventory"),
      where("marketId", "==", activeEvent.id)
    ));

    for (let start = 0; start < products.docs.length; start += 450) {
      const batch = writeBatch(db);
      products.docs.slice(start, start + 450).forEach((product) => batch.delete(product.ref));
      await batch.commit();
    }

    await deleteDoc(doc(db, "events", activeEvent.id));
    settingsDialog.close();
    toast(`Târgul și ${products.size} ${products.size === 1 ? "produs" : "produse"} au fost șterse.`);
  } catch (error) {
    console.error("Could not delete event and inventory.", error);
    showError($("#settings-form-error"), `Could not complete event deletion: ${error.message}`);
  } finally {
    deleteButton.disabled = false;
  }
}

async function handleInventorySubmit(event) {
  event.preventDefault();
  const submitButton = $("#save-inventory-button");
  const error = $("#inventory-form-error");
  clearError(error);
  submitButton.disabled = true;
  try {
    const market = state.events.find((item) => item.id === state.activeEventId);
    if (!market || eventIsClosed(market)) {
      throw new Error(market ? "Târgul este încheiat, iar stocul poate fi doar consultat." : "Creează sau selectează mai întâi un târg deschis.");
    }
    const formData = new FormData(inventoryForm);
    const totalQty = Math.max(0, Math.floor(numberValue(formData.get("totalQty"))));
    const soldQty = Math.max(0, Math.floor(numberValue(formData.get("soldQty"))));
    if (soldQty > totalQty) {
      throw new Error("Cantitatea vândută nu poate depăși stocul total. Mărește stocul sau ajustează mai întâi cantitatea vândută.");
    }
    const price = Math.max(0, numberValue(formData.get("price")));
    const product = {
      marketId: state.activeEventId,
      sku: String(formData.get("sku")).trim(),
      name: String(formData.get("name")).trim(),
      category: String(formData.get("category")),
      imageBase64: state.imageBase64,
      price,
      unitCost: Math.max(0, numberValue(formData.get("unitCost"))),
      totalQty,
      soldQty,
      notes: String(formData.get("notes") ?? "").trim(),
      updatedAt: serverTimestamp()
    };

    if (state.editingId) {
      const write = updateDoc(doc(db, "inventory", state.editingId), product);
      inventoryDialog.close();
      toast(navigator.onLine ? "Produs actualizat." : "Produs actualizat local; se va sincroniza la conectare.");
      void write.catch((error) => {
        console.error("Could not save product.", error);
        toast(`Nu s-a putut salva produsul: ${error.message}`, true);
      });
    } else {
      const write = addDoc(collection(db, "inventory"), product);
      inventoryDialog.close();
      toast(navigator.onLine ? "Produs adăugat." : "Produs adăugat local; se va sincroniza la conectare.");
      void write.catch((error) => {
        console.error("Could not save product.", error);
        toast(`Nu s-a putut salva produsul: ${error.message}`, true);
      });
    }
  } catch (error) {
    console.error("Could not save product.", error);
    showError($("#inventory-form-error"), error.message);
  } finally {
    submitButton.disabled = false;
  }
}

async function changeSoldCount(id, delta) {
  if (eventIsClosed(state.events.find((event) => event.id === state.activeEventId))) return;
  const item = state.inventory.find((product) => product.id === id);
  if (!item) return;
  const nextSold = numberValue(item.soldQty) + delta;
  if (nextSold < 0 || nextSold > numberValue(item.totalQty)) return;
  try {
    const write = updateDoc(doc(db, "inventory", id), {
      soldQty: nextSold,
      updatedAt: serverTimestamp()
    });
    toast(navigator.onLine
      ? (delta > 0 ? "Vânzare înregistrată." : "Cantitatea vândută a fost actualizată.")
      : (delta > 0 ? "Vânzare înregistrată local; se va sincroniza online." : "Cantitatea vândută a fost actualizată local; se va sincroniza online."));
    void write.catch((error) => {
      console.error("Could not update sold quantity.", error);
      toast(`Nu s-a putut actualiza cantitatea vândută: ${error.message}`, true);
    });
  } catch (error) {
    console.error("Could not update sold quantity.", error);
    toast(`Nu s-a putut actualiza cantitatea vândută: ${error.message}`, true);
  }
}

async function changeTotalCount(id, delta) {
  if (eventIsClosed(state.events.find((event) => event.id === state.activeEventId))) return;
  const item = state.inventory.find((product) => product.id === id);
  if (!item) return;
  const nextTotal = numberValue(item.totalQty) + delta;
  if (nextTotal < numberValue(item.soldQty)) return;
  try {
    const write = updateDoc(doc(db, "inventory", id), {
      totalQty: nextTotal,
      updatedAt: serverTimestamp()
    });
    toast(navigator.onLine
      ? (delta > 0 ? "Stocul a fost mărit cu o unitate." : "Stocul a fost redus cu o unitate.")
      : (delta > 0 ? "Stocul a fost mărit local; se va sincroniza online." : "Stocul a fost redus local; se va sincroniza online."));
    void write.catch((error) => {
      console.error("Could not update stock quantity.", error);
      toast(`Nu s-a putut actualiza cantitatea din stoc: ${error.message}`, true);
    });
  } catch (error) {
    console.error("Could not update stock quantity.", error);
    toast(`Nu s-a putut actualiza cantitatea din stoc: ${error.message}`, true);
  }
}

async function deleteProduct(id) {
  if (eventIsClosed(state.events.find((event) => event.id === state.activeEventId))) {
    toast("Târgul este încheiat, iar stocul poate fi doar consultat.", true);
    return;
  }
  const item = state.inventory.find((product) => product.id === id);
  if (!item || !window.confirm(`Ștergi produsul „${item.name}” din acest târg? Acțiunea nu poate fi anulată.`)) return;
  try {
    const write = deleteDoc(doc(db, "inventory", id));
    toast(navigator.onLine ? "Produs șters." : "Produs șters local; modificarea se va sincroniza la conectare.");
    void write.catch((error) => {
      console.error("Could not delete product.", error);
      toast(`Nu s-a putut șterge produsul: ${error.message}`, true);
    });
  } catch (error) {
    console.error("Could not delete product.", error);
    toast(`Nu s-a putut șterge produsul: ${error.message}`, true);
  }
}

function exportCsv() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event) {
    toast("Selectează un târg înainte de a exporta.", true);
    return;
  }
  const fields = ["SKU", "Product Name", "Color", "Category", "Price", "Unit Cost", "Total Qty", "Available Qty", "Sold Qty", "Money Made", "Total Price", "Net Profit", "Notes"];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = state.inventory.map((item) => {
    const price = numberValue(item.price);
    const cost = numberValue(item.unitCost);
    const total = numberValue(item.totalQty);
    const sold = numberValue(item.soldQty);
    return [
      item.sku,
      item.name,
      item.color ?? "Standard",
      item.category,
      price.toFixed(2),
      cost.toFixed(2),
      total,
      availableFor(item),
      sold,
      (price * sold).toFixed(2),
      (price * total).toFixed(2),
      ((price - cost) * sold).toFixed(2),
      item.notes
    ];
  });
  const csv = `\uFEFF${[fields, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.name.replace(/[\\/:*?"<>|]+/g, "-")}-inventory.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Exportul CSV este pregătit.");
}

function onInventoryAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "sold-minus") void changeSoldCount(id, -1);
  if (action === "sold-plus") void changeSoldCount(id, 1);
  if (action === "total-minus") void changeTotalCount(id, -1);
  if (action === "total-plus") void changeTotalCount(id, 1);
  if (action === "edit") openInventoryDialog(state.inventory.find((item) => item.id === id));
  if (action === "delete") void deleteProduct(id);
}

function initializeAppUi() {
  configureLogin();
  setOblioStatus(state.oblioProxyUrl
    ? "Proxy-ul Oblio configurat pentru această aplicație este gata de utilizare."
    : "Proxy-ul Oblio nu este configurat. Adaugă VITE_OBLIO_PROXY_URL în GitHub Actions Variables și redeploy.");
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError($("#login-error"));
    const button = $("#login-button");
    button.disabled = true;
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, $("#login-email").value.trim(), $("#login-password").value);
    } catch (error) {
      console.error("Sign-in failed.", error);
      showError($("#login-error"), error.code === "auth/invalid-credential"
        ? "Adresa de e-mail sau parola nu sunt corecte."
        : error.message);
    } finally {
      button.disabled = !isFirebaseConfigured;
    }
  });

  $("#logout-button").addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign-out failed.", error);
      toast(`Deconectarea a eșuat: ${error.message}`, true);
    }
  });
  $("#settings-logout-button").addEventListener("click", async () => {
    try {
      await signOut(auth);
      settingsDialog.close();
    } catch (error) {
      console.error("Sign-out failed.", error);
      toast(`Deconectarea a eșuat: ${error.message}`, true);
    }
  });
  $("#delete-event-button").addEventListener("click", () => void deleteActiveEvent());
  $("#import-csv-button").addEventListener("click", () => void importMarketFromCsv());

  $("#back-button").addEventListener("click", goBackToParentPage);
  $("#home-menu-button").addEventListener("click", () => {
    const menu = $("#home-menu");
    const expanded = $("#home-menu-button").getAttribute("aria-expanded") === "true";
    menu.hidden = expanded;
    $("#home-menu-button").setAttribute("aria-expanded", String(!expanded));
  });
  $("#home-menu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-nav-page]");
    if (button) showPage(button.dataset.navPage);
  });
  $("#mobile-menu-toggle").addEventListener("click", () => {
    const expanded = $("#mobile-menu-toggle").getAttribute("aria-expanded") === "true";
    $("#mobile-menu-toggle").setAttribute("aria-expanded", String(!expanded));
    $("#mobile-menu-toggle").setAttribute("aria-label", expanded ? "Deschide meniul" : "Închide meniul");
    $(".topbar").classList.toggle("is-menu-open", !expanded);
  });
  $("#primary-navigation").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.id === "home-menu-button") return;
    $(".topbar").classList.remove("is-menu-open");
    $("#mobile-menu-toggle").setAttribute("aria-expanded", "false");
    $("#mobile-menu-toggle").setAttribute("aria-label", "Deschide meniul");
  });
  document.addEventListener("click", (event) => {
    if ($("#primary-navigation").contains(event.target)) return;
    $("#home-menu").hidden = true;
    $("#home-menu-button").setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#home-menu").hidden) {
      $("#home-menu").hidden = true;
      $("#home-menu-button").setAttribute("aria-expanded", "false");
      $("#home-menu-button").focus();
      return;
    }
    if ($(".topbar").classList.contains("is-menu-open")) {
      $(".topbar").classList.remove("is-menu-open");
      $("#mobile-menu-toggle").setAttribute("aria-expanded", "false");
      $("#mobile-menu-toggle").setAttribute("aria-label", "Deschide meniul");
      $("#mobile-menu-toggle").focus();
    }
  });
  $("#workspace-page").addEventListener("click", (event) => {
    const card = event.target.closest("[data-module]");
    if (card?.dataset.module === "inventory") showPage("inventory-home");
    if (card?.dataset.module === "accounting") showPage("accounting");
    if (event.target.closest('[data-home-page="items"]')) showPage("items");
  });
  $("#inventory-home-page").addEventListener("click", (event) => {
    if (event.target.closest('[data-inventory-page="markets"]')) showPage("dashboard");
    if (event.target.closest('[data-inventory-page="market-history"]')) showPage("market-history");
    if (event.target.closest('[data-inventory-page="materials"]')) showPage("materials");
  });
  $("#add-material-button").addEventListener("click", () => openMaterialDialog());
  $("#materials-empty-add-button").addEventListener("click", () => openMaterialDialog());
  $("#materials-search").addEventListener("input", (event) => {
    state.materialsSearch = event.currentTarget.value;
    renderMaterials();
  });
  $("#materials-mobile-list").addEventListener("click", onMaterialAction);
  $("#materials-table-body").addEventListener("click", onMaterialAction);
  materialForm.addEventListener("submit", handleMaterialSubmit);
  materialForm.elements.unit.addEventListener("change", (event) => {
    const step = event.currentTarget.value === "pcs" ? "1" : "0.01";
    materialForm.elements.quantity.step = step;
    materialForm.elements.usedQuantity.step = step;
  });
  $("#market-history-year").addEventListener("change", (event) => {
    state.marketHistoryYear = event.currentTarget.value;
    renderMarketHistory();
  });
  $("#close-market-button").addEventListener("click", openMarketCloseDialog);
  $("#refresh-market-total-button").addEventListener("click", () => void refreshMarketSoldTotal());
  $("#market-close-form").addEventListener("submit", handleMarketCloseSubmit);
  $("#past-market-form").addEventListener("submit", handlePastMarketSubmit);
  $("#past-market-year").addEventListener("change", (event) => {
    const form = $("#past-market-form");
    const year = event.currentTarget.value;
    form.elements.startDate.value = `${year}-01-01`;
    form.elements.endDate.value = `${year}-01-01`;
    form.elements.durationDays.value = "1";
  });
  $("#past-market-form").elements.startDate.addEventListener("change", syncPastMarketDates);
  $("#past-market-form").elements.endDate.addEventListener("change", syncPastMarketDates);
  $("#past-market-form").elements.cashIncome.addEventListener("input", updatePastMarketTotalIncome);
  $("#past-market-form").elements.bankIncome.addEventListener("input", updatePastMarketTotalIncome);
  $("#settings-button").addEventListener("click", () => {
    $("#settings-page-email").textContent = state.user?.email ?? "";
    showPage("settings");
  });
  $("#settings-page").addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-action]");
    if (!button) return;
    const { settingsAction } = button.dataset;
    if (settingsAction === "add-past-market") openPastMarketDialog();
    if (settingsAction === "edit-event") {
      if (state.activeEventId) openSettingsDialog();
      else toast("Alege un târg înainte de a-l edita.", true);
    }
    if (settingsAction === "add-event") openNewEventDialog();
    if (settingsAction === "remove-event") {
      if (state.activeEventId) void deleteActiveEvent();
      else toast("Alege un târg înainte de a-l șterge.", true);
    }
    if (settingsAction === "categories") openCategoryDialog();
    if (settingsAction === "import-event") {
      openImportDialog();
    }
    if (settingsAction === "import-accounting") openAccountingImportDialog();
    if (settingsAction === "open-accounting") showPage("accounting");
    if (settingsAction === "open-items") showPage("items");
    if (settingsAction === "account") {
      $("#account-dialog-email").textContent = state.user?.email ?? "";
      accountDialog.showModal();
    }
  });
  $("#account-dialog-logout").addEventListener("click", async () => {
    try {
      await signOut(auth);
      accountDialog.close();
    } catch (error) {
      console.error("Sign-out failed.", error);
      toast(`Deconectarea a eșuat: ${error.message}`, true);
    }
  });
  $("#event-select-button").addEventListener("click", () => {
    const menu = $("#event-menu");
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    $("#event-select-button").setAttribute("aria-expanded", String(!isOpen));
  });
  $("#event-menu").addEventListener("click", (event) => {
    const option = event.target.closest("[data-event-id]");
    if (!option) return;
    state.activeEventId = option.dataset.eventId;
    state.selectedCategory = "All";
    $("#event-menu").hidden = true;
    $("#event-select-button").setAttribute("aria-expanded", "false");
    renderEvents();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".event-select-wrap")) {
      $("#event-menu").hidden = true;
      $("#event-select-button").setAttribute("aria-expanded", "false");
    }
    if (!event.target.closest(".topbar")) {
      $(".topbar").classList.remove("is-menu-open");
      $("#mobile-menu-toggle").setAttribute("aria-expanded", "false");
      $("#mobile-menu-toggle").setAttribute("aria-label", "Deschide meniul");
    }
  });
  $("#add-catalog-item-button").addEventListener("click", () => openCatalogItemDialog());
  $("#catalog-empty-add-button").addEventListener("click", () => openCatalogItemDialog());
  $("#catalog-search").addEventListener("input", (event) => {
    state.catalogSearch = event.target.value;
    renderCatalog();
  });
  $("#catalog-category-filter").addEventListener("change", (event) => {
    state.catalogCategory = event.target.value;
    renderCatalog();
  });
  $("#catalog-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-catalog-action]");
    if (!button) return;
    const { catalogAction, id } = button.dataset;
    const product = state.catalog.find((item) => item.id === id);
    if (catalogAction === "edit" && product) openCatalogItemDialog(product);
    if (catalogAction === "add" && product) openProductQuantityDialog(product);
    if (catalogAction === "delete") void deleteCatalogItem(id);
  });
  $("#add-catalog-variant").addEventListener("click", () => {
    if (state.catalogVariants.length >= 12) {
      toast("Un articol poate avea cel mult 12 variante de culoare.", true);
      return;
    }
    state.catalogVariants.push({ id: createVariantId(), color: "", imageBase64: "" });
    renderCatalogVariants();
  });
  $("#catalog-variants").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-variant]");
    if (!button || state.catalogVariants.length <= 1) return;
    state.catalogVariants = state.catalogVariants.filter((variant) => variant.id !== button.dataset.removeVariant);
    renderCatalogVariants();
  });
  $("#catalog-variants").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-variant-image]");
    if (!input) return;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError($("#catalog-item-error"), "Alege un fișier imagine.");
      input.value = "";
      return;
    }
    try {
      const imageBase64 = await compressImage(file);
      const variant = state.catalogVariants.find((item) => item.id === input.closest("[data-variant-row]")?.dataset.variantId);
      if (!variant) throw new Error("Imaginea nu a putut fi asociată variantei de culoare.");
      variant.imageBase64 = imageBase64;
      input.closest("[data-variant-row]").querySelector(".variant-image-preview").innerHTML =
        `<img src="data:image/jpeg;base64,${escapeHtml(imageBase64)}" alt="${escapeHtml(variant.color)} variant preview">`;
      clearError($("#catalog-item-error"));
    } catch (error) {
      console.error("Could not prepare variant image.", error);
      showError($("#catalog-item-error"), error.message);
    }
  });
  $("#product-picker-search").addEventListener("input", (event) => {
    state.pickerSearch = event.target.value;
    renderProductPicker();
  });
  $("#product-picker-category").addEventListener("change", (event) => {
    state.pickerCategory = event.target.value;
    renderProductPicker();
  });
  $("#product-picker-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-picker-product]");
    const product = state.catalog.find((item) => item.id === button?.dataset.pickerProduct);
    if (product) openProductQuantityDialog(product);
  });
  $("#open-catalog-from-picker").addEventListener("click", () => {
    productPickerDialog.close();
    showPage("items");
  });
  $("#catalog-item-form").addEventListener("submit", handleCatalogItemSubmit);
  $("#category-form").addEventListener("submit", handleCategorySubmit);
  $("#product-quantity-form").addEventListener("submit", handleProductQuantitySubmit);
  $("#category-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-action]");
    if (!button) return;
    if (button.dataset.categoryAction === "edit") editCategory(button.dataset.id);
    if (button.dataset.categoryAction === "delete") void deleteCategory(button.dataset.id);
  });
  $("#cancel-category-edit").addEventListener("click", () => {
    state.editingCategoryId = null;
    $("#category-form").reset();
    $("#category-input-label").textContent = "Categorie nouă";
    $("#save-category-button").textContent = "Adaugă categoria";
    $("#cancel-category-edit").hidden = true;
    clearError($("#category-form-error"));
  });

  $("#new-event-button").addEventListener("click", openNewEventDialog);
  $("#empty-add-button").addEventListener("click", (event) => {
    if (event.currentTarget.dataset.action === "new-event") openNewEventDialog();
    else openInventoryDialog();
  });
  $("#add-inventory-button").addEventListener("click", () => openInventoryDialog());
  $("#mobile-add-button").addEventListener("click", () => openInventoryDialog());
  $("#export-button").addEventListener("click", exportCsv);
  $("#accounting-add-button").addEventListener("click", () => openAccountingDialog());
  $("#accounting-mobile-add").addEventListener("click", () => openAccountingDialog());
  $("#accounting-page").addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-accounting-view]");
    if (viewButton) setAccountingView(viewButton.dataset.accountingView);
    const quickLink = event.target.closest("[data-accounting-view-link]");
    if (quickLink) setAccountingView(quickLink.dataset.accountingViewLink);
  });
  $("#f4109-dismiss-button").addEventListener("click", () => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    try {
      localStorage.setItem(`brodal:f4109-dismissed:${monthKey}`, "true");
      $("#f4109-reminder").hidden = true;
    } catch (error) {
      console.error("Could not dismiss the F4109 reminder.", error);
      toast("Reminderul F4109 nu a putut fi ascuns pentru luna aceasta.", true);
    }
  });
  $("#accounting-empty").addEventListener("click", (event) => {
    if (event.target.closest("[data-accounting-add]")) openAccountingDialog();
  });
  $("#accounting-year-filter").addEventListener("change", (event) => {
    state.accountingYear = event.target.value;
    renderAccounting();
  });
  $("#accounting-month-filter").addEventListener("change", (event) => {
    state.accountingMonth = event.target.value;
    renderAccounting();
  });
  $("#accounting-search").addEventListener("input", (event) => {
    state.accountingSearch = event.target.value;
    renderAccounting();
  });
  $("#accounting-export-button").addEventListener("click", exportAccountingCsv);
  $("#accounting-fiscal-year-filter").addEventListener("change", (event) => {
    state.accountingFiscalYear = event.target.value;
    renderFiscalRegister();
  });
  $("#accounting-fiscal-export-button").addEventListener("click", exportFiscalRegisterCsv);
  $("#accounting-fiscal-print-button").addEventListener("click", printFiscalRegister);
  $("#oblio-load-invoices-button").addEventListener("click", () => void loadOblioInvoices());
  $("#oblio-sync-paid-button").addEventListener("click", () => void syncPaidOblioInvoices());
  $("#accounting-mobile-list").addEventListener("click", onAccountingAction);
  $("#accounting-table-body").addEventListener("click", onAccountingAction);
  accountingForm.addEventListener("submit", handleAccountingSubmit);
  accountingImportForm.addEventListener("submit", handleAccountingImportSubmit);
  $("#accounting-import-file").addEventListener("change", () => void previewAccountingImport());
  $("#accounting-import-year").addEventListener("input", () => void previewAccountingImport());
  accountingForm.elements.nrCrt.addEventListener("input", () => {
    state.accountingNumberEdited = true;
  });
  accountingForm.elements.dataOperatiunii.addEventListener("change", (event) => {
    if (!state.editingAccountingId && !state.accountingNumberEdited) {
      accountingForm.elements.nrCrt.value = nextAccountingEntryNumber(event.target.value);
    }
  });

  $("#search-input").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderInventory();
  });
  $("#category-pills").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.selectedCategory = button.dataset.category;
    renderInventory();
  });
  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.sortBy === button.dataset.sort) state.sortDirection *= -1;
      else {
        state.sortBy = button.dataset.sort;
        state.sortDirection = 1;
      }
      renderInventory();
    });
  });
  $("#mobile-inventory").addEventListener("click", onInventoryAction);
  $("#inventory-table-body").addEventListener("click", onInventoryAction);
  eventForm.addEventListener("submit", handleEventSubmit);
  settingsForm.addEventListener("submit", handleSettingsSubmit);
  inventoryForm.addEventListener("submit", handleInventorySubmit);
  inventoryForm.addEventListener("input", (event) => {
    if (["price", "totalQty", "soldQty"].includes(event.target.name)) updateLivePreview();
  });
  $("#image-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError($("#inventory-form-error"), "Alege un fișier imagine.");
      event.target.value = "";
      return;
    }
    try {
      state.imageBase64 = await compressImage(file);
      renderImagePreview();
      clearError($("#inventory-form-error"));
    } catch (error) {
      console.error("Could not prepare image.", error);
      showError($("#inventory-form-error"), error.message);
    }
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });
  [eventDialog, materialDialog, inventoryDialog, settingsDialog, importDialog, accountDialog, accountingDialog, productPickerDialog, productQuantityDialog, catalogItemDialog, categoryDialog, marketCloseDialog, pastMarketDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  window.addEventListener("online", setConnectionStatus);
  window.addEventListener("offline", setConnectionStatus);
  setConnectionStatus();
}

initializeAppUi();

if (!isFirebaseConfigured) {
  setScreen("login");
} else {
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    if (user) {
      $("#user-email").textContent = user.email ?? "";
      $("#settings-page-email").textContent = user.email ?? "";
      showPage("hub");
      setScreen("app");
      startCatalogListeners();
      subscribeToMaterials();
      subscribeToEvents();
      subscribeToAccountingEntries();
    } else {
      state.inventoryUnsubscribe?.();
      state.catalogUnsubscribe?.();
      state.categoriesUnsubscribe?.();
      state.materialsUnsubscribe?.();
      state.accountingUnsubscribe?.();
      state.events = [];
      state.inventory = [];
      state.catalog = [];
      state.materials = [];
      state.categoryRecords = [];
      state.accountingEntries = [];
      state.accountingLoading = false;
      state.activeEventId = "";
      state.catalogMigrationStarted = false;
      showPage("hub");
      setScreen("login");
    }
  }, (error) => {
    console.error("Could not verify sign-in state.", error);
    setScreen("login");
    showError($("#login-error"), `Nu s-a putut verifica autentificarea: ${error.message}`);
  });
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Service worker registration failed.", error);
    });
  });
}
