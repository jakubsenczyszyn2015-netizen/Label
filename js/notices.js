// The bell in the header. Holds app messages — chiefly the "out of date"
// warning that appears when the page was opened from a stale bookmark or a
// cached copy that predates the deployed build.

const items = [];
const listeners = new Set();

export function notices() {
  return items;
}

export function onNotices(listener) {
  listeners.add(listener);
  listener(items);
}

export function addNotice(notice) {
  if (items.some((item) => item.id === notice.id)) return;
  items.unshift({ seen: false, ...notice });
  for (const listener of listeners) listener(items);
}

export function markAllSeen() {
  for (const item of items) item.seen = true;
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
    if (!build || build === currentBuild) return;

    addNotice({
      id: "outdated",
      level: "warn",
      title: "Out dated!",
      body: "You're running an old copy of Label, probably from a bookmark or " +
        "cache. Tap Update to load the newest version.",
      action: { label: "Update", run: () => location.reload(true) },
    });
  } catch {
    // Offline: nothing to say about versions.
  }
}
