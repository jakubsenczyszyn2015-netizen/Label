// People storage: Supabase when configured, otherwise localStorage.

const cfg = window.LABEL_CONFIG || {};
const KEY = "label.people";
const TABLE = "people";

let client = null;

async function getClient() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  if (!client) {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  return client;
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function writeLocal(people) {
  localStorage.setItem(KEY, JSON.stringify(people));
}

export async function listPeople() {
  const db = await getClient();
  if (!db) return readLocal();

  const { data, error } = await db
    .from(TABLE)
    .select("id, name, note, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("Supabase read failed, using local copy:", error.message);
    return readLocal();
  }
  return data;
}

export async function addPerson({ name, note }) {
  const person = { name, note, created_at: new Date().toISOString() };
  const db = await getClient();

  if (!db) {
    const people = readLocal();
    person.id = crypto.randomUUID();
    people.push(person);
    writeLocal(people);
    return person;
  }

  const { data, error } = await db.from(TABLE).insert(person).select().single();
  if (error) throw new Error(error.message);
  return data;
}
