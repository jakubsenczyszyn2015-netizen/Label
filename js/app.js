import { listPeople, addPerson } from "./store.js";

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

  item.append(avatar, text);
  return item;
}

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
