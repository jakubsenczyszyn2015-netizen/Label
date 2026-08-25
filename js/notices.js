// The bell in the header. Holds app messages — chiefly the "out of date"
// warning that appears when the page was opened from a stale bookmark or a
// cached copy that predates the deployed build.

const items = [];
const listeners = new Set();
const SEEN_KEY = "label.seen-notices";

// Seen state is remembered, so a notice you have already read does not come
// back with a red dot every time the app starts.
function seenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []);
  } catch {
    return new Set();
  }
}

function rememberSeen() {
  const ids = items.filter((item) => item.seen).map((item) => item.id);
  localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(0, 40)));
}

export function notices() {
  return items;
}

export function onNotices(listener) {
  listeners.add(listener);
  listener(items);
}

export function addNotice(notice) {
  if (items.some((item) => item.id === notice.id)) return;
  items.unshift({ seen: seenIds().has(notice.id), ...notice });
  for (const listener of listeners) listener(items);
}

export function removeNotice(id) {
  const at = items.findIndex((item) => item.id === id);
  if (at === -1) return;
  items.splice(at, 1);
  for (const listener of listeners) listener(items);
}

export function markAllSeen() {
  for (const item of items) item.seen = true;
  rememberSeen();
  for (const listener of listeners) listener(items);
}

export function unseenCount() {
  return items.filter((item) => !item.seen).length;
}

// Compares the build this page was loaded from against the deployed one.
export async function checkForUpdate(currentBuild) {
  try {
    const response = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;

    const { build } = await response.json();
    if (!build || build === currentBuild) {
      // Back in step with the server — drop any stale warning.
      removeNotice("outdated");
      return;
    }

    addNotice({
      id: "outdated",
      level: "warn",
      title: "Out dated!",
      body: "You're running an old copy of Label, probably from a bookmark or " +
        "cache. Tap Update to load the newest version.",
      action: { label: "Update", run: update },
    });
  } catch {
    // Offline: nothing to say about versions.
  }
}

// Clears caches and the service worker before reloading, so the update really
// lands instead of coming back from the cache it was stuck on.
async function update() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.unregister();
  } catch {
    // Cleared what we could; the reload still helps.
  }
  location.replace(`${location.pathname}?u=${Date.now()}`);
}

// Re-check when the app comes back to the foreground, and every 30 minutes.
export function watchForUpdates(currentBuild) {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForUpdate(currentBuild);
  });
  setInterval(() => checkForUpdate(currentBuild), 30 * 60 * 1000);
}
