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

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" });
const state = {
  user: null,
  events: [],
  activeEventId: "",
  inventory: [],
  selectedCategory: "All",
  search: "",
  sortBy: "name",
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
  catalogImageBase64: "",
  selectedCatalogProductId: "",
  editingCategoryId: null,
  currentPage: "dashboard",
  catalogMigrationStarted: false,
  toastTimer: null,
  inventoryLoading: false
};

const loginScreen = $("#login-screen");
const appShell = $("#app-shell");
const eventDialog = $("#event-dialog");
const inventoryDialog = $("#inventory-dialog");
const productPickerDialog = $("#product-picker-dialog");
const productQuantityDialog = $("#product-quantity-dialog");
const catalogItemDialog = $("#catalog-item-dialog");
const categoryDialog = $("#category-dialog");
const settingsDialog = $("#settings-dialog");
const importDialog = $("#import-dialog");
const accountDialog = $("#account-dialog");
const inventoryForm = $("#inventory-form");
const eventForm = $("#event-form");
const settingsForm = $("#settings-form");

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
  status.textContent = online ? "Online" : "Offline";
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
    notice.textContent = "Finish Firebase setup first: add your project settings to firebase-config.js, then reload this page.";
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

function renderEvents() {
  const selectedId = state.activeEventId;
  if (!state.events.some((event) => event.id === selectedId)) {
    state.activeEventId = state.events[0]?.id ?? "";
  }

  const activeEvent = state.events.find((event) => event.id === state.activeEventId);
  $("#event-select-value").textContent = activeEvent?.name ?? "No events yet — create your first event";
  $("#event-select-button").disabled = state.events.length === 0;
  $("#event-menu").innerHTML = state.events.map((event) => `
    <button class="event-menu-option" type="button" role="option" data-event-id="${escapeHtml(event.id)}" aria-selected="${event.id === state.activeEventId}">
      <span class="event-menu-name">${escapeHtml(event.name)}</span>
      <span class="event-menu-meta">${escapeHtml(event.type)} · ${escapeHtml(eventDateRange(event))}</span>
    </button>
  `).join("");
  if (state.events.length === 0) {
    $("#event-menu").hidden = true;
    $("#event-select-button").setAttribute("aria-expanded", "false");
  }
  $("#add-inventory-button").disabled = !state.activeEventId;
  $("#mobile-add-button").disabled = !state.activeEventId;
  renderActiveEvent();
  subscribeToInventory();
}

function renderActiveEvent() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  const heading = $("#event-heading");
  heading.hidden = !event;
  if (!event) return;
  $("#event-type").textContent = event.type;
  $("#event-name").textContent = event.name;
  $("#event-details").textContent = [eventDateRange(event), event.location].filter(Boolean).join(" · ");
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
      toast(`Could not load events: ${error.message}`, true);
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
    toast(`Could not load item catalog: ${error.message}`, true);
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
    toast(`Could not load item categories: ${error.message}`, true);
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
    toast(`Could not initialize default categories: ${error.message}`, true);
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
    toast(`Could not prepare item catalog: ${error.message}`, true);
  }
}

function renderCategoryControls() {
  const options = state.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  const catalogSelection = $("#catalog-item-category").value;
  const inventorySelection = inventoryForm.elements.category.value;
  $("#catalog-item-category").innerHTML = options;
  inventoryForm.elements.category.innerHTML = options;
  if (state.categories.includes(catalogSelection)) $("#catalog-item-category").value = catalogSelection;
  if (state.categories.includes(inventorySelection)) inventoryForm.elements.category.value = inventorySelection;

  const catalogFilter = $("#catalog-category-filter");
  const previousCatalogFilter = state.catalogCategory;
  catalogFilter.innerHTML = `<option value="All">All categories</option>${options}`;
  if (state.categories.includes(previousCatalogFilter)) catalogFilter.value = previousCatalogFilter;
  else catalogFilter.value = "All";

  const pickerFilter = $("#product-picker-category");
  const previousPickerFilter = state.pickerCategory;
  pickerFilter.innerHTML = `<option value="All">All categories</option>${options}`;
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
      || String(product.name ?? "").toLocaleLowerCase().includes(search))
  );
  if (![...$("#catalog-category-filter").options].some((option) => option.value === state.catalogCategory)) {
    state.catalogCategory = "All";
  }
  $("#catalog-category-filter").value = state.catalogCategory;
  $("#catalog-loading").hidden = false;
  $("#catalog-empty-state").hidden = true;
  $("#catalog-grid").innerHTML = products.map((product) => `
    <article class="catalog-card">
      <div class="catalog-card-image product-thumb">${imageMarkup(product)}</div>
      <div class="catalog-card-main">
        <div class="catalog-card-title">
          <div><h2>${escapeHtml(product.name)}</h2><span class="sku-badge">${escapeHtml(product.sku)}</span></div>
          <span class="product-card-category">${escapeHtml(product.category)}</span>
        </div>
        <strong class="catalog-price">${money.format(numberValue(product.price))}</strong>
        <p class="muted catalog-note">Price changes apply to future markets only.</p>
        <div class="catalog-card-actions">
          <button class="button button-outline" type="button" data-catalog-action="edit" data-id="${escapeHtml(product.id)}">Edit item / price</button>
          <button class="button button-primary" type="button" data-catalog-action="add" data-id="${escapeHtml(product.id)}" ${!state.activeEventId ? "disabled" : ""}>Add to current market</button>
          <button class="button button-danger" type="button" data-catalog-action="delete" data-id="${escapeHtml(product.id)}">Remove</button>
        </div>
      </div>
    </article>
  `).join("");
  $("#catalog-empty-state").hidden = state.catalog.length > 0;
  $("#catalog-loading").hidden = true;
}

function renderProductPicker() {
  const search = state.pickerSearch.trim().toLocaleLowerCase();
  const products = state.catalog.filter((product) =>
    (state.pickerCategory === "All" || product.category === state.pickerCategory)
    && (!search
      || String(product.sku ?? "").toLocaleLowerCase().includes(search)
      || String(product.name ?? "").toLocaleLowerCase().includes(search))
  );
  const activeEventItems = new Set(state.inventory.flatMap((item) => [
    item.productId,
    String(item.sku ?? "").trim().toLocaleLowerCase()
  ]).filter(Boolean));
  $("#product-picker-list").innerHTML = products.map((product) => {
    const alreadyAdded = activeEventItems.has(product.id)
      || activeEventItems.has(String(product.sku ?? "").trim().toLocaleLowerCase());
    return `<button class="picker-product" type="button" data-picker-product="${escapeHtml(product.id)}" ${alreadyAdded ? "disabled" : ""}>
      <span class="product-thumb">${imageMarkup(product)}</span>
      <span class="picker-product-main"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</small></span>
      <span class="picker-product-price">${money.format(numberValue(product.price))}</span>
      <span class="picker-product-action">${alreadyAdded ? "Added" : "＋"}</span>
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
        <button class="text-button" type="button" data-category-action="edit" data-id="${escapeHtml(category.id)}">Rename</button>
        <button class="text-button danger" type="button" data-category-action="delete" data-id="${escapeHtml(category.id)}" ${inUse ? "disabled" : ""}>Remove</button>
      </span>
    </div>`;
  }).join("");
}

function showPage(name) {
  state.currentPage = name;
  $("#dashboard-page").hidden = name !== "dashboard";
  $("#items-page").hidden = name !== "items";
  $("#settings-page").hidden = name !== "settings";
  $(".mobile-action-bar").hidden = name !== "dashboard";
  $("#items-page-button").setAttribute("aria-current", name === "items" ? "page" : "false");
  $("#settings-button").setAttribute("aria-current", name === "settings" ? "page" : "false");
  if (name === "items") renderCatalog();
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
      toast(`Could not load inventory: ${error.message}`, true);
    }
  );
}

function getFilteredInventory() {
  const search = state.search.trim().toLocaleLowerCase();
  return state.inventory
    .filter((item) => state.selectedCategory === "All" || item.category === state.selectedCategory)
    .filter((item) => !search
      || String(item.sku ?? "").toLocaleLowerCase().includes(search)
      || String(item.name ?? "").toLocaleLowerCase().includes(search))
    .sort((a, b) => {
      const first = a[state.sortBy] ?? "";
      const second = b[state.sortBy] ?? "";
      const comparison = typeof first === "number" && typeof second === "number"
        ? first - second
        : String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: "base" });
      return comparison * state.sortDirection;
    });
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
  return `<span class="sold-control">
    <button class="stepper-button" type="button" data-action="sold-minus" data-id="${escapeHtml(item.id)}" aria-label="Record one fewer sold for ${escapeHtml(item.name)}" ${sold <= 0 ? "disabled" : ""}>−</button>
    <strong>${sold}</strong>
    <button class="stepper-button" type="button" data-action="sold-plus" data-id="${escapeHtml(item.id)}" aria-label="Record one sold for ${escapeHtml(item.name)}" ${sold >= total ? "disabled" : ""}>+</button>
  </span>`;
}

function totalQuantityControls(item) {
  const total = numberValue(item.totalQty);
  const sold = numberValue(item.soldQty);
  return `<span class="sold-control">
    <button class="stepper-button" type="button" data-action="total-minus" data-id="${escapeHtml(item.id)}" aria-label="Remove one from stock for ${escapeHtml(item.name)}" ${total <= sold ? "disabled" : ""}>−</button>
    <strong>${total}</strong>
    <button class="stepper-button" type="button" data-action="total-plus" data-id="${escapeHtml(item.id)}" aria-label="Add one to stock for ${escapeHtml(item.name)}">+</button>
  </span>`;
}

function productActions(item) {
  return `<span class="row-actions">
    <button class="text-button" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">Edit</button>
    <button class="text-button danger" type="button" data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>
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
  $("#summary-profit").textContent = `Net profit ${money.format(totals.profit)}`;
  $("#summary-potential").textContent = money.format(totals.potential);
}

function renderCategoryPills() {
  const categories = [...new Set(state.inventory.map((item) => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const choices = ["All", ...categories];
  if (!choices.includes(state.selectedCategory)) state.selectedCategory = "All";
  $("#category-pills").innerHTML = choices.map((category) => `
    <button class="category-pill" type="button" data-category="${escapeHtml(category)}" aria-pressed="${state.selectedCategory === category}">${escapeHtml(category)}</button>
  `).join("");
}

function renderInventory() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  const loading = $("#inventory-loading");
  const empty = $("#empty-state");
  const mobile = $("#mobile-inventory");
  const tableBody = $("#inventory-table-body");
  const filtered = getFilteredInventory();

  loading.hidden = !state.inventoryLoading;
  renderSummary();
  renderCategoryPills();
  $("#inventory-count").textContent = event
    ? `${filtered.length} ${filtered.length === 1 ? "product" : "products"}${filtered.length !== state.inventory.length ? ` shown · ${state.inventory.length} total` : ""}`
    : "Choose or create an event to manage its products.";

  const showEmpty = !state.inventoryLoading && (state.inventory.length === 0 || filtered.length === 0);
  empty.hidden = !showEmpty;
  if (state.inventory.length === 0) {
    $("#empty-title").textContent = event ? "Your inventory starts here" : "Create your first event";
    $("#empty-description").textContent = event
      ? "Add your first product to keep its stock and sales close at hand."
      : "Set up a market or shop update before adding products.";
    $("#empty-add-button").textContent = event ? "＋ Add your first product" : "＋ New Event";
    $("#empty-add-button").dataset.action = event ? "add" : "new-event";
  } else if (filtered.length === 0) {
    $("#empty-title").textContent = "No matching products";
    $("#empty-description").textContent = "Try another search or choose a different category.";
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
        </div>
        <span class="product-card-category">${escapeHtml(item.category)}</span>
      </div>
      <div class="product-card-price">${money.format(numberValue(item.price))}</div>
      <div class="product-card-stats">
        <div class="product-stat"><span>Available</span><strong><span class="available-badge ${availableClass(available, total)}">${available}</span></strong></div>
        <div class="product-stat"><span>Money made</span><strong>${money.format(revenue)}</strong></div>
        <div class="product-stat"><span>Total price</span><strong>${money.format(potential)}</strong></div>
      </div>
      <div class="product-card-quantities">
        <div class="product-quantity-control"><span>In stock</span>${totalQuantityControls(item)}</div>
        <div class="product-quantity-control"><span>Sold</span>${soldControls(item)}</div>
      </div>
      <div class="product-card-bottom">
        <span class="sold-label">${sold} sold of ${total}</span>
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
      <td class="product-name-cell" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category)}</td>
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
    button.setAttribute("aria-label", `${button.textContent.trim()}${active ? (state.sortDirection === 1 ? ", ascending" : ", descending") : ""}`);
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
  $("#inventory-form-title").textContent = item ? "Edit inventory" : "Add inventory";
  $("#inventory-form-eyebrow").textContent = item ? "UPDATE PRODUCT DETAILS" : "PRODUCT DETAILS";
  $("#save-inventory-button").textContent = item ? "Save changes" : "Save product";
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
    : "<span>Image preview</span>";
}

function openInventoryDialog(item = null) {
  if (!state.activeEventId) {
    toast("Create or choose an event before adding inventory.", true);
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
  if (!state.activeEventId) {
    toast("Create or choose an event before adding inventory.", true);
    return;
  }
  if (state.inventory.some((item) =>
    item.productId === product.id
    || String(item.sku ?? "").trim().toLocaleLowerCase() === String(product.sku ?? "").trim().toLocaleLowerCase()
  )) {
    toast("This item is already in the selected market.", true);
    return;
  }
  state.selectedCatalogProductId = product.id;
  $("#selected-product-name").textContent = product.name;
  $("#selected-product-details").textContent = `${product.sku} · ${product.category} · ${money.format(numberValue(product.price))}`;
  $("#product-quantity-form").reset();
  $("#product-quantity-error").hidden = true;
  productQuantityDialog.showModal();
}

function openCatalogItemDialog(product = null) {
  $("#catalog-item-form").reset();
  state.editingCatalogId = product?.id ?? null;
  state.catalogImageBase64 = product?.imageBase64 ?? "";
  $("#catalog-item-title").textContent = product ? "Edit Item" : "Add Item";
  $("#catalog-item-eyebrow").textContent = product ? "UPDATE ITEM CATALOG" : "PRODUCT CATALOG";
  $("#save-catalog-item-button").textContent = product ? "Save changes" : "Save item";
  $("#catalog-item-error").hidden = true;
  renderCategoryControls();
  if (product) {
    $("#catalog-item-form").elements.sku.value = product.sku ?? "";
    $("#catalog-item-form").elements.name.value = product.name ?? "";
    $("#catalog-item-form").elements.category.value = product.category ?? state.categories[0] ?? "";
    $("#catalog-item-form").elements.price.value = numberValue(product.price);
    $("#catalog-item-form").elements.unitCost.value = numberValue(product.unitCost);
    $("#catalog-item-form").elements.notes.value = product.notes ?? "";
  }
  $("#catalog-image-input").value = "";
  $("#catalog-image-preview").innerHTML = state.catalogImageBase64
    ? `<img src="data:image/jpeg;base64,${escapeHtml(state.catalogImageBase64)}" alt="Item preview">`
    : "<span>Image preview</span>";
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
    if (duplicate) throw new Error(`SKU "${sku}" is already used by ${duplicate.name}.`);

    const product = {
      sku,
      name: String(formData.get("name")).trim(),
      category: String(formData.get("category")),
      imageBase64: state.catalogImageBase64,
      price: Math.max(0, numberValue(formData.get("price"))),
      unitCost: Math.max(0, numberValue(formData.get("unitCost"))),
      notes: String(formData.get("notes") ?? "").trim(),
      updatedAt: serverTimestamp()
    };
    if (state.editingCatalogId) {
      await updateDoc(doc(db, "products", state.editingCatalogId), product);
      toast("Item catalog updated. Existing market prices were not changed.");
    } else {
      await addDoc(collection(db, "products"), { ...product, createdAt: serverTimestamp() });
      toast("Item added to your catalog.");
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
  if (!product || !window.confirm(`Remove "${product.name}" from the item catalog? Existing market records will stay unchanged.`)) return;
  try {
    await deleteDoc(doc(db, "products", id));
    toast("Item removed from catalog; old market records were kept.");
  } catch (error) {
    console.error("Could not remove catalog item.", error);
    toast(`Could not remove catalog item: ${error.message}`, true);
  }
}

async function handleProductQuantitySubmit(event) {
  event.preventDefault();
  const product = state.catalog.find((item) => item.id === state.selectedCatalogProductId);
  if (!product || !state.activeEventId) return;
  const error = $("#product-quantity-error");
  clearError(error);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await addDoc(collection(db, "inventory"), {
      marketId: state.activeEventId,
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      imageBase64: product.imageBase64 ?? "",
      price: numberValue(product.price),
      unitCost: numberValue(product.unitCost),
      totalQty: Math.max(0, Math.floor(numberValue(event.currentTarget.elements.totalQty.value))),
      soldQty: 0,
      notes: String(event.currentTarget.elements.notes.value ?? "").trim(),
      updatedAt: serverTimestamp()
    });
    productQuantityDialog.close();
    productPickerDialog.close();
    toast(`${product.name} added to this market.`);
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
  $("#category-input-label").textContent = "New category";
  $("#save-category-button").textContent = "Add category";
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
  $("#category-input-label").textContent = "Rename category";
  $("#save-category-button").textContent = "Save category";
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
    showError(formError, `The category "${duplicate}" already exists.`);
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
      toast(`Category renamed to ${name}. Existing market records were not changed.`);
    } else {
      await setDoc(doc(db, "categories", categoryDocumentId(name)), {
        name,
        createdAt: serverTimestamp()
      });
      toast(`Category "${name}" added.`);
    }

    state.editingCategoryId = null;
    $("#category-form").reset();
    $("#category-input-label").textContent = "New category";
    $("#save-category-button").textContent = "Add category";
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
    toast("Reassign catalog items before removing this category.", true);
    return;
  }
  if (!window.confirm(`Remove "${category.name}" from the category list? Old market records will retain it.`)) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    toast(`Category "${category.name}" removed. Historical market records were kept.`);
  } catch (error) {
    console.error("Could not remove category.", error);
    toast(`Could not remove category: ${error.message}`, true);
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
    ? "Edit this event or remove it and its inventory."
    : "Create or choose an event to manage it.";
  $("#settings-account-email").textContent = state.user?.email ?? "Signed in";

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

  if (insideQuotes) throw new Error("The CSV has an unfinished quoted field.");
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  if (rows.length < 2) throw new Error("The CSV must contain a header row and at least one product.");

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
    throw new Error(`Row ${rowNumber}: ${fieldName} must be a non-negative whole number.`);
  }
  return number;
}

function parseCsvPrice(value, fieldName, rowNumber, optional = false) {
  const normalized = String(value ?? "").trim();
  if (!normalized && optional) return 0;
  if (!normalized) throw new Error(`Row ${rowNumber}: ${fieldName} cannot be empty.`);
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
    throw new Error(`Row ${rowNumber}: ${fieldName} must be a non-negative number.`);
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
    throw new Error(`Missing required CSV column${missing.length === 1 ? "" : "s"}: ${missing.map((header) => labels[header]).join(", ")}.`);
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
      throw new Error(`Row ${rowNumber}: SKU, Product Name, and Category cannot be empty.`);
    }
    const totalQty = parseCsvQuantity(read(cells, "totalqty"), "Total Qty", rowNumber);
    const soldQty = parseCsvQuantity(read(cells, "soldqty"), "Sold Qty", rowNumber);
    if (soldQty > totalQty) {
      throw new Error(`Row ${rowNumber}: Sold Qty cannot be greater than Total Qty.`);
    }
    return {
      sku,
      name,
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
    showError(error, "Choose the CSV file to import.");
    return;
  }
  if (!name || !startDate || !endDate) {
    showError(error, "Enter the event name, start date, and end date.");
    return;
  }
  if (endDate < startDate) {
    showError(error, "The end date must be the same as or later than the start date.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showError(error, "The CSV file is larger than 5 MB. Export or split a smaller inventory file.");
    return;
  }

  button.disabled = true;
  button.textContent = "Importing…";
  let eventCreated = false;
  let importedCount = 0;
  try {
    const products = inventoryFromCsv(await file.text());
    const seenSkus = new Set();
    products.forEach((product) => {
      const skuKey = product.sku.toLocaleLowerCase();
      if (seenSkus.has(skuKey)) throw new Error(`The CSV contains duplicate SKU "${product.sku}".`);
      seenSkus.add(skuKey);
    });

    const importedProducts = new Map();
    const existingProducts = new Map(state.catalog.map((product) => [
      String(product.sku ?? "").trim().toLocaleLowerCase(),
      product
    ]));
    products.forEach((product) => {
      const skuKey = product.sku.toLocaleLowerCase();
      const existing = existingProducts.get(skuKey);
      importedProducts.set(skuKey, existing
        ? { product, productId: existing.id, shouldCreateCatalogItem: false }
        : { product, productId: doc(collection(db, "products")).id, shouldCreateCatalogItem: true });
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
      createdAt: serverTimestamp()
    };

    for (let start = 0; start < products.length || start === 0; start += 200) {
      const batch = writeBatch(db);
      if (start === 0) batch.set(eventRef, eventData);
      products.slice(start, start + 200).forEach((product) => {
        const catalogItem = importedProducts.get(product.sku.toLocaleLowerCase());
        if (catalogItem.shouldCreateCatalogItem) {
          batch.set(doc(db, "products", catalogItem.productId), {
            sku: product.sku,
            name: product.name,
            category: product.category,
            imageBase64: "",
            price: product.price,
            unitCost: product.unitCost,
            notes: product.notes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
        batch.set(doc(collection(db, "inventory")), {
          marketId: eventRef.id,
          productId: catalogItem.productId,
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
    toast(`Imported ${name} with ${products.length} ${products.length === 1 ? "product" : "products"}.`);
  } catch (error) {
    console.error("Could not import market from CSV.", error);
    const partialImportWarning = eventCreated
      ? ` The event and ${importedCount} product${importedCount === 1 ? "" : "s"} were already saved; check the event list before retrying.`
      : "";
    showError($("#import-form-error"), `${error.message}${partialImportWarning}`);
  } finally {
    button.disabled = false;
    button.textContent = "Import market and products";
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
        image.onerror = () => reject(new Error("That image could not be opened."));
        image.src = objectUrl;
      });
    }

    const scale = Math.min(1, 300 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the image.");
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
  const eventWrite = setDoc(eventRef, {
    name: eventData.name.trim(),
    type: eventData.type,
    startDate: eventData.startDate,
    endDate: eventData.endDate,
    location: eventData.location.trim(),
    createdAt: serverTimestamp()
  });
  void eventWrite.catch((error) => {
    console.error("Could not save event.", error);
    toast(`Could not save event: ${error.message}`, true);
  });

  if (products.length) {
    for (let start = 0; start < products.length; start += 450) {
      const batch = writeBatch(db);
      products.slice(start, start + 450).forEach((product) => {
        const productRef = doc(collection(db, "inventory"));
        batch.set(productRef, {
          marketId: eventRef.id,
          ...(product.productId ? { productId: product.productId } : {}),
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
      void batch.commit().catch((error) => {
        console.error("Could not copy catalog items.", error);
        toast(`Could not copy catalog items: ${error.message}`, true);
      });
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
      throw new Error("The end date must be the same as or later than the start date.");
    }
    const copiedCount = await createEvent({
      name: formData.get("name"),
      type: formData.get("type"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      location: formData.get("location") ?? "",
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
      throw new Error("The end date must be the same as or later than the start date.");
    }

    await updateDoc(doc(db, "events", activeEvent.id), {
      name: String(formData.get("name")).trim(),
      type: String(formData.get("type")),
      startDate,
      endDate,
      location: String(formData.get("location") ?? "").trim()
    });
    settingsDialog.close();
    toast("Event settings saved.");
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
    showError($("#settings-form-error"), "Connect to the internet before deleting an event so all its inventory can be removed safely.");
    return;
  }

  const deleteButton = $("#delete-event-button");
  clearError($("#settings-form-error"));
  if (!window.confirm(`Permanently delete "${activeEvent.name}" and all of its products and sales? This cannot be undone.`)) return;

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
    toast(`Deleted event and ${products.size} ${products.size === 1 ? "product" : "products"}.`);
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
    const formData = new FormData(inventoryForm);
    const totalQty = Math.max(0, Math.floor(numberValue(formData.get("totalQty"))));
    const soldQty = Math.max(0, Math.floor(numberValue(formData.get("soldQty"))));
    if (soldQty > totalQty) {
      throw new Error("Sold quantity cannot exceed total stock. Increase stock or adjust the sold count first.");
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
      toast(navigator.onLine ? "Product updated." : "Product updated locally; it will sync when online.");
      void write.catch((error) => {
        console.error("Could not save product.", error);
        toast(`Could not save product: ${error.message}`, true);
      });
    } else {
      const write = addDoc(collection(db, "inventory"), product);
      inventoryDialog.close();
      toast(navigator.onLine ? "Product added." : "Product added locally; it will sync when online.");
      void write.catch((error) => {
        console.error("Could not save product.", error);
        toast(`Could not save product: ${error.message}`, true);
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
      ? (delta > 0 ? "Sale recorded." : "Sold count updated.")
      : (delta > 0 ? "Sale recorded locally; it will sync online." : "Sold count updated locally; it will sync online."));
    void write.catch((error) => {
      console.error("Could not update sold quantity.", error);
      toast(`Could not update sold quantity: ${error.message}`, true);
    });
  } catch (error) {
    console.error("Could not update sold quantity.", error);
    toast(`Could not update sold quantity: ${error.message}`, true);
  }
}

async function changeTotalCount(id, delta) {
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
      ? (delta > 0 ? "Stock increased by one." : "Stock reduced by one.")
      : (delta > 0 ? "Stock increased locally; it will sync online." : "Stock reduced locally; it will sync online."));
    void write.catch((error) => {
      console.error("Could not update stock quantity.", error);
      toast(`Could not update stock quantity: ${error.message}`, true);
    });
  } catch (error) {
    console.error("Could not update stock quantity.", error);
    toast(`Could not update stock quantity: ${error.message}`, true);
  }
}

async function deleteProduct(id) {
  const item = state.inventory.find((product) => product.id === id);
  if (!item || !window.confirm(`Delete "${item.name}" from this event? This cannot be undone.`)) return;
  try {
    const write = deleteDoc(doc(db, "inventory", id));
    toast(navigator.onLine ? "Product deleted." : "Product deleted locally; it will sync when online.");
    void write.catch((error) => {
      console.error("Could not delete product.", error);
      toast(`Could not delete product: ${error.message}`, true);
    });
  } catch (error) {
    console.error("Could not delete product.", error);
    toast(`Could not delete product: ${error.message}`, true);
  }
}

function exportCsv() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event) {
    toast("Choose an event before exporting.", true);
    return;
  }
  const fields = ["SKU", "Product Name", "Category", "Price", "Unit Cost", "Total Qty", "Available Qty", "Sold Qty", "Money Made", "Total Price", "Net Profit", "Notes"];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = state.inventory.map((item) => {
    const price = numberValue(item.price);
    const cost = numberValue(item.unitCost);
    const total = numberValue(item.totalQty);
    const sold = numberValue(item.soldQty);
    return [
      item.sku,
      item.name,
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
  toast("CSV export ready.");
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
        ? "That email and password combination was not recognized."
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
      toast(`Could not log out: ${error.message}`, true);
    }
  });
  $("#settings-logout-button").addEventListener("click", async () => {
    try {
      await signOut(auth);
      settingsDialog.close();
    } catch (error) {
      console.error("Sign-out failed.", error);
      toast(`Could not log out: ${error.message}`, true);
    }
  });
  $("#delete-event-button").addEventListener("click", () => void deleteActiveEvent());
  $("#import-csv-button").addEventListener("click", () => void importMarketFromCsv());

  $("#dashboard-page-button").addEventListener("click", () => showPage("dashboard"));
  $("#items-page-button").addEventListener("click", () => showPage("items"));
  $("#settings-button").addEventListener("click", () => {
    $("#settings-page-email").textContent = state.user?.email ?? "";
    showPage("settings");
  });
  $("#settings-page").addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-action]");
    if (!button) return;
    const { settingsAction } = button.dataset;
    if (settingsAction === "edit-event") {
      if (state.activeEventId) openSettingsDialog();
      else toast("Choose a market before editing one.", true);
    }
    if (settingsAction === "add-event") openNewEventDialog();
    if (settingsAction === "remove-event") {
      if (state.activeEventId) void deleteActiveEvent();
      else toast("Choose a market before removing one.", true);
    }
    if (settingsAction === "categories") openCategoryDialog();
    if (settingsAction === "import-event") {
      openImportDialog();
    }
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
      toast(`Could not log out: ${error.message}`, true);
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
    $("#category-input-label").textContent = "New category";
    $("#save-category-button").textContent = "Add category";
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
      showError($("#inventory-form-error"), "Choose an image file.");
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
  $("#catalog-image-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError($("#catalog-item-error"), "Choose an image file.");
      event.target.value = "";
      return;
    }
    try {
      state.catalogImageBase64 = await compressImage(file);
      $("#catalog-image-preview").innerHTML = `<img src="data:image/jpeg;base64,${escapeHtml(state.catalogImageBase64)}" alt="Item preview">`;
      clearError($("#catalog-item-error"));
    } catch (error) {
      console.error("Could not prepare catalog image.", error);
      showError($("#catalog-item-error"), error.message);
    }
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });
  [eventDialog, inventoryDialog, settingsDialog, importDialog, accountDialog, productPickerDialog, productQuantityDialog, catalogItemDialog, categoryDialog].forEach((dialog) => {
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
      setScreen("app");
      startCatalogListeners();
      subscribeToEvents();
    } else {
      state.inventoryUnsubscribe?.();
      state.catalogUnsubscribe?.();
      state.categoriesUnsubscribe?.();
      state.events = [];
      state.inventory = [];
      state.catalog = [];
      state.categoryRecords = [];
      state.activeEventId = "";
      state.catalogMigrationStarted = false;
      showPage("dashboard");
      setScreen("login");
    }
  }, (error) => {
    console.error("Could not verify sign-in state.", error);
    setScreen("login");
    showError($("#login-error"), `Could not verify your sign-in: ${error.message}`);
  });
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Service worker registration failed.", error);
    });
  });
}
