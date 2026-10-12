import {
  listPeople, addPerson, deletePerson,
  listFoods, addFood, updateFood, deleteFood,
} from "./store.js";
import { renderFor, prepareLabel, shareFile, saveFile, systemPrint } from "./label.js";
import { bitmapCanvas } from "./thermal.js";
import { MODELS, labelsFor, matchLoaded } from "./raster.js";
import { printSettings, savePrintSettings } from "./settings.js";
import { ALLERGENS } from "./allergens.js";
import { shrinkToDataUrl, searchImages } from "./image.js";
import {
  transports, connectPrinter, currentPrinter, reconnect, queryStatus, printBitmap,
  defaultBridge, bridgeBlocked, bridgeTargets,
} from "./printer.js";
import {
  addNotice, onNotices, markAllSeen, unseenCount, checkForUpdate, watchForUpdates,
} from "./notices.js";

const cfg = window.LABEL_CONFIG || {};

const lock = document.getElementById("lock");
const lockForm = document.getElementById("lock-form");
const passwordInput = document.getElementById("password");
const lockError = document.getElementById("lock-error");

const app = document.getElementById("app");
const list = document.getElementById("people");
const empty = document.getElementById("empty");

const dialog = document.getElementById("person-dialog");
const personForm = document.getElementById("person-form");
const nameInput = document.getElementById("person-name");
const noteInput = document.getElementById("person-note");

const deleteDialog = document.getElementById("delete-dialog");
const deleteForm = document.getElementById("delete-form");
const deleteTarget = document.getElementById("delete-target");
const deleteConfirm = document.getElementById("delete-confirm");
const deleteSubmit = document.getElementById("delete-submit");
const deleteNote = document.getElementById("delete-note");

const peopleView = document.getElementById("people-view");
const foodView = document.getElementById("food-view");
const foodOwner = document.getElementById("food-owner");
const foodList = document.getElementById("foods");
const foodEmpty = document.getElementById("food-empty");

const foodDialog = document.getElementById("food-dialog");
const foodForm = document.getElementById("food-form");
const foodName = document.getElementById("food-name");
const foodFile = document.getElementById("food-file");
const foodImageUrl = document.getElementById("food-image-url");
const foodPreview = document.getElementById("food-preview");
const foodExpires = document.getElementById("food-expires");
const foodDescription = document.getElementById("food-description");
const allergenList = document.getElementById("allergen-list");

const detailDialog = document.getElementById("detail-dialog");
const detailTitle = document.getElementById("detail-title");
const detailLabel = document.getElementById("detail-label");

let pendingDelete = null;
let currentPerson = null;
let pickedImage = "";
let editingFood = null;
let detailFood = null;
let labelFiles = null;

// Older phone browsers lack <dialog>; fall back to plain show/hide + a scrim.
const nativeDialog = typeof HTMLDialogElement !== "undefined" &&
  typeof dialog.showModal === "function";
if (!nativeDialog) document.documentElement.classList.add("no-dialog");

// One scrim per open dialog, so stacking them stays consistent.
const scrims = new Map();

function openModal(node) {
  if (nativeDialog) {
    node.showModal();
    return;
  }
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  document.body.append(scrim);
  scrims.set(node, scrim);
  node.setAttribute("open", "");
}

function closeModal(node) {
  if (nativeDialog) {
    node.close();
    return;
  }
  node.removeAttribute("open");
  scrims.get(node)?.remove();
  scrims.delete(node);
}

if (!nativeDialog) {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    pendingDelete = null;
    for (const node of document.querySelectorAll("dialog[open]")) closeModal(node);
  });
}

/* ---------- Dialog safety net ---------- */

// Every dialog closes from its own [data-close], from Escape, and from a tap
// on the backdrop — so no action can leave you stranded on a screen.
document.addEventListener("click", (event) => {
  const closer = event.target.closest?.("[data-close]");
  if (closer) {
    const owner = closer.closest("dialog");
    if (owner) {
      pendingDelete = null;
      editingFood = null;
      closeModal(owner);
    }
    return;
  }
  // A click landing on the dialog element itself is a click on its backdrop.
  if (event.target.tagName === "DIALOG" && event.target.open) {
    closeModal(event.target);
  }
});

for (const node of document.querySelectorAll("dialog")) {
  node.addEventListener("close", () => {
    if (node === deleteDialog) pendingDelete = null;
    if (node === foodDialog) editingFood = null;
  });
  // Escape fires "cancel" before "close"; let it through but reset state.
  node.addEventListener("cancel", () => {
    if (node === deleteDialog) pendingDelete = null;
    if (node === foodDialog) editingFood = null;
  });
}

/* ---------- Maintenance ---------- */

const maintenance = document.getElementById("maintenance");

// A paused or sleeping Supabase project fails in a handful of recognisable
// ways; say so plainly instead of showing a raw database error.
function maintenanceNotice(error) {
  const message = String(error?.message || error);
  const offline = /failed to fetch|networkerror|load failed/i.test(message);
  const paused = /paused|503|502|upstream|unavailable|not found/i.test(message);

  if (paused) {
    return "Label is in maintenance — the database is paused and needs " +
      "reactivating in Supabase. Your saved data is safe.";
  }
  if (offline) {
    return navigator.onLine
      ? "Can't reach the database right now. It may be paused or restarting."
      : "You're offline. Label will catch up when you reconnect.";
  }
  return "";
}

function showMaintenance(error) {
  const notice = maintenanceNotice(error);
  maintenance.textContent = notice;
  maintenance.hidden = !notice;
  return notice;
}

/* ---------- iPhone / iPad install gate ---------- */

const gate = document.getElementById("install-gate");

const isApplePhoneOrTablet = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports as a Mac, so look for the touch screen a Mac never has.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

// Desktop is unaffected: it just runs the app.
const gated = isApplePhoneOrTablet && !isStandalone;

if (gated) {
  gate.hidden = false;
  lock.hidden = true;
  const note = document.getElementById("gate-note");
  if (!/safari/i.test(navigator.userAgent) || /crios|fxios|edgios/i.test(navigator.userAgent)) {
    note.textContent = "Open this page in Safari first — other iPhone browsers " +
      "can't add apps to the Home Screen.";
  }
}

/* ---------- Notifications ---------- */

const noticeDialog = document.getElementById("notice-dialog");
const noticeList = document.getElementById("notice-list");

function renderNotices(items) {
  noticeList.replaceChildren(...items.map((item) => {
    const row = document.createElement("li");
    row.className = `notice ${item.level || "info"}`;

    const title = document.createElement("div");
    title.className = "notice-title";
    title.textContent = item.title;

    const body = document.createElement("p");
    body.className = "notice-body";
    body.textContent = item.body;

    row.append(title, body);

    if (item.action) {
      const button = document.createElement("button");
      button.className = "btn small";
      button.type = "button";
      button.textContent = item.action.label;
      button.addEventListener("click", item.action.run);
      row.append(button);
    }
    return row;
  }));

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Nothing to report.";
    noticeList.append(empty);
  }

  const count = unseenCount();
  for (const bell of document.querySelectorAll("[data-bell]")) {
    bell.querySelector(".dot").hidden = count === 0;
    bell.classList.toggle("ringing", count > 0);
  }
}

onNotices(renderNotices);

for (const bell of document.querySelectorAll("[data-bell]")) {
  bell.addEventListener("click", () => {
    openModal(noticeDialog);
    markAllSeen();
  });
}

const BUILD = document.documentElement.dataset.build || "dev";
checkForUpdate(BUILD);
watchForUpdates(BUILD);

// Theme is per-device: it lives in this browser's storage, never in Supabase.
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem("label.theme", mode);
  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.textContent = mode === "dark" ? "☀" : "☾";
    button.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
}

applyTheme(localStorage.getItem("label.theme") === "dark" ? "dark" : "light");

for (const button of document.querySelectorAll("[data-theme-toggle]")) {
  button.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
}

const UNLOCKED = "label.unlocked";

// Unlocking sticks to the device until the lock button is used.
if (!gated && localStorage.getItem(UNLOCKED) === "yes") {
  queueMicrotask(unlock);
}

for (const button of document.querySelectorAll("[data-lock]")) {
  button.addEventListener("click", () => {
    localStorage.removeItem(UNLOCKED);
    location.reload();
  });
}

lockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (passwordInput.value !== cfg.PASSWORD) {
    lockError.hidden = false;
    passwordInput.value = "";
    passwordInput.focus();
    return;
  }
  lockError.hidden = true;
  passwordInput.value = "";
  localStorage.setItem(UNLOCKED, "yes");
  unlock();
});

function unlock() {
  lock.hidden = true;
  app.hidden = false;
  render();
}

function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function personRow(person) {
  const item = document.createElement("li");
  item.className = "person";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initials(person.name);

  const text = document.createElement("div");
  text.className = "person-text";
  const name = document.createElement("div");
  name.className = "person-name";
  name.textContent = person.name;
  text.append(name);

  if (person.note) {
    const note = document.createElement("div");
    note.className = "person-note";
    note.textContent = person.note;
    text.append(note);
  }

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Delete ${person.name}`);
  remove.addEventListener("click", () => askToDelete(person, "person"));

  text.tabIndex = 0;
  text.setAttribute("role", "button");
  text.addEventListener("click", () => openPerson(person));
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPerson(person);
    }
  });

  item.append(avatar, text, remove);
  return item;
}

/* ---------- Food view ---------- */

function openPerson(person) {
  currentPerson = person;
  foodOwner.textContent = person.name;
  peopleView.hidden = true;
  foodView.hidden = false;
  renderFoods();
}

document.getElementById("back").addEventListener("click", () => {
  currentPerson = null;
  foodView.hidden = true;
  peopleView.hidden = false;
  render();
});

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

// Green when fine, amber within three days, red once past.
function expiryState(value) {
  if (!value) return "";
  if (isExpired(value)) return "expired";
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  return value <= soon.toISOString().slice(0, 10) ? "soon" : "";
}

function isExpired(value) {
  if (!value) return false;
  const today = new Date().toISOString().slice(0, 10);
  return value < today;
}

function foodRow(food) {
  const item = document.createElement("li");
  item.className = "person food";

  const thumb = document.createElement("div");
  thumb.className = "avatar thumb";
  if (food.image_url) {
    const img = document.createElement("img");
    img.src = food.image_url;
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
  } else {
    thumb.textContent = initials(food.name);
  }

  const text = document.createElement("div");
  text.className = "person-text";

  const name = document.createElement("div");
  name.className = "person-name";
  name.textContent = food.name;
  text.append(name);

  const expiry = document.createElement("div");
  expiry.className = `meta ${expiryState(food.expires_on)}`;
  expiry.textContent = isExpired(food.expires_on)
    ? `Expired ${formatDate(food.expires_on)}`
    : `Best before ${formatDate(food.expires_on)}`;
  text.append(expiry);

  if (food.description) {
    const description = document.createElement("div");
    description.className = "person-note";
    description.textContent = food.description;
    text.append(description);
  }

  const allergens = food.allergens || [];
  if (allergens.length) {
    const tags = document.createElement("div");
    tags.className = "tags";

    for (const allergen of allergens) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = allergen;
      tags.append(tag);
    }
    text.append(tags);
  }

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Delete ${food.name}`);
  remove.addEventListener("click", () => askToDelete(food, "food"));

  text.tabIndex = 0;
  text.setAttribute("role", "button");
  text.addEventListener("click", () => openFoodDetail(food));
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFoodDetail(food);
    }
  });

  item.append(thumb, text, remove);
  return item;
}

async function renderFoods() {
  if (!currentPerson) return;

  let foods;
  try {
    foods = await listFoods();
  } catch (error) {
    foodList.replaceChildren();
    foodEmpty.hidden = false;
    foodEmpty.textContent = showMaintenance(error)
      ? "Nothing to show while the database is unavailable."
      : `Could not load food: ${error.message}`;
    return;
  }
  maintenance.hidden = true;

  foodList.replaceChildren(...foods.map(foodRow));
  foodEmpty.textContent = "No food yet. Tap + to add some.";
  foodEmpty.hidden = foods.length > 0;
}

// Allergen toggles are built once from the shared list.
for (const allergen of ALLERGENS) {
  const label = document.createElement("label");
  label.className = "allergen";

  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = allergen;

  const text = document.createElement("span");
  text.textContent = allergen;

  label.append(box, text);
  allergenList.append(label);
}

function checkedAllergens() {
  return [...allergenList.querySelectorAll("input:checked")].map((box) => box.value);
}

function setPreview(source) {
  pickedImage = source || "";
  foodPreview.hidden = !pickedImage;
  if (pickedImage) foodPreview.src = pickedImage;
}

document.getElementById("upload-btn").addEventListener("click", () => foodFile.click());

foodFile.addEventListener("change", async () => {
  const file = foodFile.files[0];
  if (!file) return;
  try {
    setPreview(await shrinkToDataUrl(file));
    foodImageUrl.value = "";
  } catch (error) {
    console.error("Could not read picture:", error.message);
  }
});

const searchDialog = document.getElementById("search-dialog");
const searchForm = document.getElementById("search-form");
const searchQuery = document.getElementById("search-query");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");

let searchRun = null;

document.getElementById("search-btn").addEventListener("click", () => {
  searchQuery.value = foodName.value.trim();
  searchResults.replaceChildren();
  searchStatus.hidden = false;
  searchStatus.textContent = "Type a name and search.";
  openModal(searchDialog);
  searchQuery.focus();
  if (searchQuery.value) searchForm.requestSubmit();
});

searchDialog.querySelector("[data-close]").addEventListener("click", () => {
  searchRun?.abort();
  closeModal(searchDialog);
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchQuery.value.trim();
  if (!query) return;

  searchRun?.abort();
  searchRun = new AbortController();
  const { signal } = searchRun;

  searchResults.replaceChildren();
  searchStatus.hidden = false;
  searchStatus.textContent = "Searching…";

  let results;
  try {
    results = await searchImages(query, signal);
  } catch (error) {
    if (signal.aborted) return;
    searchStatus.textContent = "Search failed. Check your connection.";
    return;
  }
  if (signal.aborted) return;

  if (!results.length) {
    searchStatus.textContent = `Nothing found for “${query}”.`;
    return;
  }

  searchStatus.hidden = true;
  searchResults.replaceChildren(...results.map((result) => {
    const button = document.createElement("button");
    button.className = "result";
    button.type = "button";
    button.title = result.title;

    const img = document.createElement("img");
    img.src = result.thumb;
    img.alt = result.title;
    img.loading = "lazy";
    // Drop anything that fails to load rather than showing a broken tile.
    img.addEventListener("error", () => button.remove());

    button.append(img);
    button.addEventListener("click", () => {
      setPreview(result.full);
      foodImageUrl.value = result.full;
      closeModal(searchDialog);
    });
    return button;
  }));
});

foodImageUrl.addEventListener("input", () => {
  if (foodImageUrl.value.trim()) setPreview(foodImageUrl.value.trim());
  else if (!foodFile.files.length) setPreview("");
});

/* ---------- Food detail, editing and labels ---------- */

const detailStatus = document.getElementById("detail-status");
const detailInfo = document.getElementById("detail-info");

function say(message, tone = "") {
  detailStatus.textContent = message;
  detailStatus.className = `hint ${tone}`;
  detailStatus.hidden = !message;
}

function sizeText(render, settings) {
  const label = settings.labelSpec;
  return `${label.name}${label.dk ? ` (${label.dk})` : ""} · ` +
    `${render.widthMm.toFixed(0)} × ${render.heightMm.toFixed(0)}mm`;
}

// Renders and caches every format the moment the dialog opens, so the share
// button can call navigator.share() inside the tap, as iOS requires.
async function refreshDetail() {
  if (!detailFood) return;
  const food = detailFood;
  const settings = printSettings();
  labelFiles = null;
  detailInfo.textContent = "Preparing label…";
  const files = await prepareLabel(food, settings);
  if (detailFood !== food) return;
  labelFiles = files;
  detailLabel.src = files.dataUrl;
  detailInfo.textContent = sizeText(files.render, settings);
}

async function openFoodDetail(food) {
  detailFood = food;
  detailTitle.textContent = food.name;
  detailLabel.removeAttribute("src");
  say("");
  openModal(detailDialog);
  await refreshDetail();
}

const holdDialog = document.getElementById("hold-dialog");
const holdImage = document.getElementById("hold-image");
const holdWhy = document.getElementById("hold-why");

// When the share sheet is missing or refuses the file: pressing and holding
// an image works on every phone.
function offerHold(reason) {
  holdWhy.textContent = reason;
  holdImage.src = detailLabel.src;
  closeModal(detailDialog);
  openModal(holdDialog);
}

function notReady() {
  if (labelFiles) return false;
  say("Still preparing the label — try again in a second.");
  return true;
}

// Send to the Brother app. A label-sized PDF is what iPrint&Label accepts
// from the share sheet — it's what iOS hands over from Print → Share — and
// because the page is the label's own size it prints 1:1.
document.getElementById("detail-share").addEventListener("click", () => {
  if (!detailFood || notReady()) return;
  say("");
  shareFile(labelFiles.pdf).then((how) => {
    if (how === "unsupported") {
      // No file sharing for PDFs here; an image is the next best thing.
      shareFile(labelFiles.png).then((next) => {
        if (next === "unsupported" || next === "refused") {
          offerHold("This browser can't send files to other apps, so save the label to your photos instead.");
        }
      });
    } else if (how === "refused") {
      offerHold("The share sheet wouldn't take the label. Saving it to your photos works just as well.");
    }
  });
});

document.getElementById("detail-png").addEventListener("click", () => {
  if (!notReady()) say(OUTCOME[saveFile(labelFiles.png)] || "");
});

document.getElementById("detail-pdf").addEventListener("click", () => {
  if (!notReady()) say(OUTCOME[saveFile(labelFiles.pdf)] || "");
});

document.getElementById("detail-photos").addEventListener("click", () => {
  if (notReady()) return;
  shareFile(labelFiles.png).then((how) => {
    if (how === "shared" || how === "cancelled") return;
    offerHold("Press and hold the label to save it to your photos.");
  });
});

const OUTCOME = {
  saved: "Saved to your downloads.",
  opened: "Opened in a new tab — press and hold to save it.",
  blocked: "Your browser blocked the download. Press and hold the label above to save it.",
};

/* ---------- Print sheet ---------- */

const printDialog = document.getElementById("print-dialog");
const printPreview = document.getElementById("print-preview");
const printInfo = document.getElementById("print-info");
const printModel = document.getElementById("print-model");
const printLabelSelect = document.getElementById("print-label");
const printCopies = document.getElementById("print-copies");
const printCut = document.getElementById("print-cut");
const printPicture = document.getElementById("print-picture");
const printStatus = document.getElementById("print-status");
const printerPill = document.getElementById("printer-pill");
const printerName = document.getElementById("printer-name");
const printSend = document.getElementById("print-send");
const detectButton = document.getElementById("print-detect");
const bridgeFields = document.getElementById("bridge-fields");
const bridgeUrl = document.getElementById("bridge-url");
const bridgeTarget = document.getElementById("bridge-target");

let printRender = null;
let mismatch = null;

printModel.replaceChildren(...["ql", "pt"].map((family) => {
  const group = document.createElement("optgroup");
  group.label = family === "ql" ? "QL label printers (DK rolls)" : "P-touch (TZe tape)";
  for (const model of MODELS.filter((entry) => entry.family === family)) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `Brother ${model.id}`;
    group.append(option);
  }
  return group;
}));

function fillLabels(settings) {
  printLabelSelect.replaceChildren(...labelsFor(settings.modelSpec).map((label) => {
    const option = document.createElement("option");
    option.value = label.id;
    option.textContent = label.dk ? `${label.name} · ${label.dk}` : label.name;
    return option;
  }));
  printLabelSelect.value = settings.label;
}

function printSay(message, tone = "") {
  printStatus.replaceChildren();
  printStatus.className = `hint ${tone}`;
  printStatus.hidden = !message;
  if (!message) return;
  printStatus.append(document.createTextNode(message));
}

function printSayError(error) {
  printSay(error.message, "warn");
  if (error.hint) {
    const hint = document.createElement("span");
    hint.className = "sub";
    hint.textContent = ` ${error.hint}`;
    printStatus.append(hint);
  }
  if (error.loaded) {
    mismatch = error.loaded;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn small inline-btn";
    button.textContent = `Use ${error.loaded.name}`;
    button.addEventListener("click", () => applySettings({ label: error.loaded.id }));
    printStatus.append(button);
  }
}

function showPrinter() {
  const printer = currentPrinter();
  printerPill.textContent = printer ? "Connected" : "Not connected";
  printerPill.classList.toggle("on", Boolean(printer));
  printerName.textContent = printer ? printer.name : "Choose how to reach the printer below.";
  printSend.textContent = printer ? "Print" : "Connect a printer to print";
  printSend.disabled = !printer;
  detectButton.hidden = !printer?.canStatus;
}

// Draws exactly the dots that will print, scaled up without smoothing.
async function refreshPreview() {
  if (!detailFood) return;
  const settings = printSettings();
  printInfo.textContent = "Laying out…";
  printRender = await renderFor(detailFood, settings);

  const canvas = bitmapCanvas(printRender.view);
  printPreview.width = canvas.width;
  printPreview.height = canvas.height;
  printPreview.getContext("2d").drawImage(canvas, 0, 0);
  printPreview.classList.toggle("tape", settings.modelSpec.family === "pt");

  const dots = `${printRender.view.width} × ${printRender.view.height} dots`;
  printInfo.textContent = `${sizeText(printRender, settings)} · ${dots}`;
}

async function applySettings(patch) {
  const settings = savePrintSettings(patch);
  printModel.value = settings.model;
  fillLabels(settings);
  printCopies.value = settings.copies;
  printCut.checked = settings.cut;
  printPicture.checked = settings.picture;
  printPicture.disabled = !detailFood?.image_url;
  mismatch = null;
  await refreshPreview();
  // Keep the detail preview and the shared files in step with the settings.
  refreshDetail();
}

printModel.addEventListener("change", () => applySettings({ model: printModel.value }));
printLabelSelect.addEventListener("change", () => applySettings({ label: printLabelSelect.value }));
printCut.addEventListener("change", () => applySettings({ cut: printCut.checked }));
printPicture.addEventListener("change", () => applySettings({ picture: printPicture.checked }));
printCopies.addEventListener("change", () => {
  const copies = Math.min(50, Math.max(1, Number(printCopies.value) || 1));
  printCopies.value = copies;
  savePrintSettings({ copies });
});

for (const step of document.querySelectorAll("[data-step]")) {
  step.addEventListener("click", () => {
    const copies = Math.min(50, Math.max(1, (Number(printCopies.value) || 1) + Number(step.dataset.step)));
    printCopies.value = copies;
    savePrintSettings({ copies });
  });
}

document.getElementById("detail-print").addEventListener("click", async () => {
  if (!detailFood) return;
  const available = transports();
  document.getElementById("connect-usb").disabled = !available.usb;
  document.getElementById("connect-bt").disabled = !available.bluetooth;
  document.getElementById("connect-ble").disabled = !available.ble;
  document.getElementById("print-unsupported").hidden = available.usb || available.bluetooth;

  printSay("");
  openModal(printDialog);
  if (!currentPrinter()) await reconnect();
  showPrinter();
  await applySettings({});
});

async function connect(kind, options) {
  printSay(kind === "bridge" ? "Contacting the bridge…" : "Choose your printer in the browser's list…");
  try {
    const printer = await connectPrinter(kind, options);
    showPrinter();
    printSay(`Connected to ${printer.name}.`, "ok");
    if (printer.canStatus) detect(true);
  } catch (error) {
    showPrinter();
    if (error.name === "NotFoundError") printSay("No printer chosen.");
    else printSayError(error);
  }
}

// Asks the printer what is loaded and switches the label to match.
async function detect(quiet = false) {
  if (!quiet) printSay("Asking the printer what's loaded…");
  const status = await queryStatus().catch(() => null);
  if (!status) {
    if (!quiet) printSay("The printer didn't report its label. Choose the size by hand.", "warn");
    return;
  }
  if (status.errors.length) {
    printSay(`${status.errors.join(". ")}.`, "warn");
    return;
  }
  const loaded = matchLoaded(printSettings().modelSpec, status);
  if (!loaded) {
    printSay(`The printer reports a ${status.width}mm label this app doesn't know. Choose the nearest size.`, "warn");
    return;
  }
  await applySettings({ label: loaded.id });
  printSay(`Loaded: ${loaded.name}. Ready.`, "ok");
}

detectButton.addEventListener("click", () => detect(false));
document.getElementById("connect-usb").addEventListener("click", () => connect("usb"));
document.getElementById("connect-bt").addEventListener("click", () => connect("bluetooth"));
document.getElementById("connect-ble").addEventListener("click", () => connect("ble"));

bridgeUrl.value = defaultBridge();

document.getElementById("connect-bridge").addEventListener("click", async () => {
  bridgeFields.hidden = !bridgeFields.hidden;
  if (bridgeFields.hidden) return;
  await loadBridgeTargets();
});

async function loadBridgeTargets() {
  const bridge = bridgeUrl.value.trim();
  bridgeTarget.replaceChildren();
  if (bridgeBlocked(bridge)) {
    printSay("This page is on https, so it can only reach a bridge on this same computer " +
      "(http://localhost:8080). From a phone, open Label from the bridge's own address.", "warn");
    return;
  }
  try {
    const targets = await bridgeTargets(bridge);
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.label;
      option.target = target;
      bridgeTarget.append(option);
    }
    localStorage.setItem("label.bridge", bridge);
    printSay(targets.length ? "" : "The bridge has no printers set up.", targets.length ? "" : "warn");
  } catch {
    printSay("Couldn't reach the bridge. Is it running, and is this address right?", "warn");
  }
}

bridgeUrl.addEventListener("change", loadBridgeTargets);

document.getElementById("bridge-go").addEventListener("click", () => {
  const option = bridgeTarget.selectedOptions[0];
  if (!option) {
    printSay("Pick a printer from the bridge first.", "warn");
    return;
  }
  connect("bridge", { bridge: bridgeUrl.value.trim(), target: option.target });
  bridgeFields.hidden = true;
});

printSend.addEventListener("click", async () => {
  if (!detailFood || !currentPrinter()) return;
  const settings = printSettings();
  const copies = Math.min(50, Math.max(1, Number(printCopies.value) || 1));

  printSend.disabled = true;
  printSay(`Printing ${copies} label${copies > 1 ? "s" : ""}…`);
  try {
    if (!printRender) await refreshPreview();
    const result = await printBitmap({
      model: settings.modelSpec,
      label: settings.labelSpec,
      bitmap: printRender.print,
      copies,
      cut: settings.cut,
    });
    printSay(result.confirmed
      ? `Printed ${copies} label${copies > 1 ? "s" : ""}. The printer confirmed it.`
      : `Sent to the printer (${Math.round(result.bytes / 1024)} KB).`, "ok");
  } catch (error) {
    printSayError(error);
  } finally {
    printSend.disabled = !currentPrinter();
  }
});

document.getElementById("system-print").addEventListener("click", async () => {
  if (!detailFood) return;
  try {
    await systemPrint(detailFood);
  } catch (error) {
    printSay(`Couldn't open printing: ${error.message}`, "warn");
  }
});

document.getElementById("detail-edit").addEventListener("click", () => {
  closeModal(detailDialog);
  openFoodForm(detailFood);
});

function openFoodForm(food) {
  editingFood = food || null;
  foodForm.reset();

  foodDialog.querySelector(".dialog-title").textContent =
    food ? "Edit food" : "New food";
  foodDialog.querySelector("button[type=submit]").textContent =
    food ? "Save" : "Add";

  setPreview(food?.image_url || "");
  if (food) {
    foodName.value = food.name;
    foodImageUrl.value = food.image_url?.startsWith("data:") ? "" : food.image_url || "";
    foodExpires.value = food.expires_on || "";
    foodDescription.value = food.description || "";
    const chosen = new Set(food.allergens || []);
    for (const box of allergenList.querySelectorAll("input")) {
      box.checked = chosen.has(box.value);
    }
  }

  openModal(foodDialog);
  foodName.focus();
}

document.getElementById("add-food").addEventListener("click", () => openFoodForm(null));

foodDialog.querySelector("[data-close]").addEventListener("click", () => {
  editingFood = null;
  closeModal(foodDialog);
});

foodForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = foodName.value.trim();
  if (!name || !currentPerson) return;

  const food = {
    person_id: null, // shared with every profile
    name,
    image_url: pickedImage || null,
    expires_on: foodExpires.value || null,
    description: foodDescription.value.trim() || null,
    allergens: checkedAllergens(),
  };

  const editing = editingFood;
  editingFood = null;
  closeModal(foodDialog);

  try {
    if (editing) {
      const { person_id, ...patch } = food;
      await updateFood(editing.id, patch);
    } else {
      await addFood(food);
    }
  } catch (error) {
    console.error("Could not save food:", error.message);
    foodEmpty.hidden = false;
    foodEmpty.textContent = `Could not save: ${error.message}`;
    return;
  }
  renderFoods();
});

function askToDelete(record, kind) {
  pendingDelete = { record, kind };
  deleteDialog.querySelector(".dialog-title").textContent =
    kind === "food" ? "Delete food" : "Delete person";
  deleteNote.hidden = kind !== "food";
  deleteTarget.textContent = record.name;
  deleteConfirm.value = "";
  deleteSubmit.disabled = true;
  openModal(deleteDialog);
  deleteConfirm.focus();
}

// The typed name must match exactly before Delete becomes available.
deleteConfirm.addEventListener("input", () => {
  deleteSubmit.disabled =
    !pendingDelete || deleteConfirm.value.trim() !== pendingDelete.record.name;
});

deleteDialog.querySelector("[data-close]").addEventListener("click", () => {
  pendingDelete = null;
  closeModal(deleteDialog);
});

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = pendingDelete;
  if (!target || deleteConfirm.value.trim() !== target.record.name) return;

  pendingDelete = null;
  closeModal(deleteDialog);

  const isFood = target.kind === "food";
  const notice = isFood ? foodEmpty : empty;

  try {
    if (isFood) await deleteFood(target.record.id);
    else await deletePerson(target.record.id);
  } catch (error) {
    console.error("Could not delete:", error.message);
    notice.hidden = false;
    notice.textContent = "Could not delete. Check your connection and try again.";
    return;
  }
  if (isFood) renderFoods();
  else render();
});

async function render() {
  let people;
  try {
    people = await listPeople();
  } catch (error) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = showMaintenance(error)
      ? "Nothing to show while the database is unavailable."
      : `Could not load people: ${error.message}`;
    return;
  }
  maintenance.hidden = true;

  list.replaceChildren(...people.map(personRow));
  empty.textContent = "No people yet. Tap + to add one.";
  empty.hidden = people.length > 0;
}

document.getElementById("add-person").addEventListener("click", () => {
  personForm.reset();
  openModal(dialog);
  nameInput.focus();
});

dialog.querySelector("[data-close]").addEventListener("click", () => {
  closeModal(dialog);
});

personForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;

  closeModal(dialog);
  try {
    await addPerson({ name, note: noteInput.value.trim() || null });
  } catch (error) {
    console.error("Could not add person:", error.message);
    empty.hidden = false;
    empty.textContent = `Could not save: ${error.message}`;
    return;
  }
  render();
});
