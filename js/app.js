import { listPeople, addPerson, deletePerson } from "./store.js";

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

let pendingDelete = null;

// Theme: white by default; a settings screen can flip this later.
const theme = localStorage.getItem("label.theme");
if (theme === "dark") document.documentElement.dataset.theme = "dark";

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
  remove.addEventListener("click", () => askToDelete(person));

  item.append(avatar, text, remove);
  return item;
}

function askToDelete(person) {
  pendingDelete = person;
  deleteTarget.textContent = person.name;
  deleteConfirm.value = "";
  deleteSubmit.disabled = true;
  deleteDialog.showModal();
  deleteConfirm.focus();
}

// The typed name must match exactly before Delete becomes available.
deleteConfirm.addEventListener("input", () => {
  deleteSubmit.disabled =
    !pendingDelete || deleteConfirm.value.trim() !== pendingDelete.name;
});

deleteDialog.querySelector("[data-close]").addEventListener("click", () => {
  pendingDelete = null;
  deleteDialog.close();
});

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const person = pendingDelete;
  if (!person || deleteConfirm.value.trim() !== person.name) return;

  pendingDelete = null;
  deleteDialog.close();

  try {
    await deletePerson(person.id);
  } catch (error) {
    console.error("Could not delete person:", error.message);
    empty.hidden = false;
    empty.textContent = "Could not delete. Check your connection and try again.";
    return;
  }
  render();
});

async function render() {
  const people = await listPeople();
  list.replaceChildren(...people.map(personRow));
  empty.textContent = "No people yet. Tap + to add one.";
  empty.hidden = people.length > 0;
}

document.getElementById("add-person").addEventListener("click", () => {
  personForm.reset();
  dialog.showModal();
  nameInput.focus();
});

dialog.querySelector("[data-close]").addEventListener("click", () => {
  dialog.close();
});

personForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;

  dialog.close();
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
