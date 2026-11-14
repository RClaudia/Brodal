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
  toastTimer: null,
  inventoryLoading: false
};

const loginScreen = $("#login-screen");
const appShell = $("#app-shell");
const eventDialog = $("#event-dialog");
const inventoryDialog = $("#inventory-dialog");
const settingsDialog = $("#settings-dialog");
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
  const select = $("#event-select");
  const selectedId = state.activeEventId;
  select.innerHTML = state.events.length
    ? state.events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.type)} · ${escapeHtml(event.name)} · ${escapeHtml(eventDateRange(event))}</option>`).join("")
    : '<option value="">No events yet — create your first event</option>';
  select.disabled = state.events.length === 0;

  if (state.events.some((event) => event.id === selectedId)) {
    select.value = selectedId;
  } else {
    state.activeEventId = state.events[0]?.id ?? "";
    select.value = state.activeEventId;
  }

  $("#add-inventory-button").disabled = !state.activeEventId;
  $("#mobile-add-button").disabled = !state.activeEventId;
  $("#settings-button").disabled = !state.activeEventId;
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
  resetInventoryForm(item);
  inventoryDialog.showModal();
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
  settingsDialog.showModal();
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
    const eventRef = doc(collection(db, "events"));
    const eventData = {
      name,
      type: $("#import-event-type").value,
      startDate,
      endDate,
      location: $("#import-event-location").value.trim(),
      createdAt: serverTimestamp()
    };

    for (let start = 0; start < products.length || start === 0; start += 450) {
      const batch = writeBatch(db);
      if (start === 0) batch.set(eventRef, eventData);
      products.slice(start, start + 450).forEach((product) => {
        batch.set(doc(collection(db, "inventory")), {
          marketId: eventRef.id,
          ...product,
          imageBase64: "",
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
      eventCreated = true;
      importedCount += products.slice(start, start + 450).length;
    }

    state.activeEventId = eventRef.id;
    settingsDialog.close();
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
  $("#settings-button").addEventListener("click", openSettingsDialog);
  $("#delete-event-button").addEventListener("click", () => void deleteActiveEvent());
  $("#import-csv-button").addEventListener("click", () => void importMarketFromCsv());

  $("#event-select").addEventListener("change", (event) => {
    state.activeEventId = event.target.value;
    state.selectedCategory = "All";
    $("#add-inventory-button").disabled = !state.activeEventId;
    $("#mobile-add-button").disabled = !state.activeEventId;
    $("#settings-button").disabled = !state.activeEventId;
    renderActiveEvent();
    subscribeToInventory();
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

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });
  [eventDialog, inventoryDialog, settingsDialog].forEach((dialog) => {
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
      setScreen("app");
      subscribeToEvents();
    } else {
      state.inventoryUnsubscribe?.();
      state.events = [];
      state.inventory = [];
      state.activeEventId = "";
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
