import {
  listPeople, addPerson, deletePerson,
  listFoods, addFood, deleteFood,
} from "./store.js";
import { ALLERGENS } from "./allergens.js";
import { shrinkToDataUrl, searchImages } from "./image.js";

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

let pendingDelete = null;
let currentPerson = null;
let pickedImage = "";

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
  expiry.className = "person-note";
  expiry.textContent = isExpired(food.expires_on)
    ? `Expired ${formatDate(food.expires_on)}`
    : `Best before ${formatDate(food.expires_on)}`;
  if (isExpired(food.expires_on)) expiry.classList.add("expired");
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

  item.append(thumb, text, remove);
  return item;
}

async function renderFoods() {
  if (!currentPerson) return;
  const foods = await listFoods();
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

document.getElementById("add-food").addEventListener("click", () => {
  foodForm.reset();
  setPreview("");
  openModal(foodDialog);
  foodName.focus();
});

foodDialog.querySelector("[data-close]").addEventListener("click", () => {
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

  closeModal(foodDialog);
  try {
    await addFood(food);
  } catch (error) {
    console.error("Could not add food:", error.message);
    foodEmpty.hidden = false;
    foodEmpty.textContent = "Could not save. Check your connection and try again.";
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
  const people = await listPeople();
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
    empty.textContent = "Could not save. Check your connection and try again.";
    return;
  }
  render();
});
