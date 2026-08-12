// People storage: Supabase when configured, otherwise localStorage.

const cfg = window.LABEL_CONFIG || {};
const KEY = "label.people";
const TABLE = "people";
const FOOD_KEY = "label.foods";
const FOOD_TABLE = "foods";

let client = null;

async function getClient() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  if (!client) {
    try {
      const { createClient } = await import(
        "https://esm.sh/@supabase/supabase-js@2"
      );
      client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (error) {
      // Offline or the CDN is unreachable — fall back to local storage.
      console.warn("Supabase client unavailable:", error.message);
      return null;
    }
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

function readFoodsLocal() {
  try {
    return JSON.parse(localStorage.getItem(FOOD_KEY)) || [];
  } catch {
    return [];
  }
}

function writeFoodsLocal(foods) {
  localStorage.setItem(FOOD_KEY, JSON.stringify(foods));
}

export async function listFoods(personId) {
  // A null person_id means the food is shared, so it shows in every profile.
  const mine = (food) => food.person_id === personId || food.person_id === null;

  const db = await getClient();
  if (!db) return readFoodsLocal().filter(mine);

  const { data, error } = await db
    .from(FOOD_TABLE)
    .select("id, person_id, name, image_url, expires_on, description, allergens, created_at")
    .or(`person_id.eq.${personId},person_id.is.null`)
    .order("expires_on", { ascending: true });

  if (error) {
    console.warn("Supabase read failed, using local copy:", error.message);
    return readFoodsLocal().filter(mine);
  }
  return data;
}

export async function addFood(food) {
  const row = { ...food, created_at: new Date().toISOString() };
  const db = await getClient();

  if (!db) {
    const foods = readFoodsLocal();
    row.id = crypto.randomUUID();
    foods.push(row);
    writeFoodsLocal(foods);
    return row;
  }

  const { data, error } = await db.from(FOOD_TABLE).insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteFood(id) {
  const db = await getClient();

  if (!db) {
    writeFoodsLocal(readFoodsLocal().filter((food) => food.id !== id));
    return;
  }

  const { error } = await db.from(FOOD_TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePerson(id) {
  const db = await getClient();

  if (!db) {
    writeLocal(readLocal().filter((person) => person.id !== id));
    writeFoodsLocal(readFoodsLocal().filter((food) => food.person_id !== id));
    return;
  }
  // In Supabase the food rows go with the person via ON DELETE CASCADE.

  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
