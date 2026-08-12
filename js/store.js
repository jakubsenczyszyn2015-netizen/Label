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
    const local = readLocal();
    if (local.length) {
      console.warn("Supabase read failed, using local copy:", error.message);
      return local;
    }
    throw new Error(error.message);
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

  // No .select() here: reading the row back would also need a select policy,
  // and its absence would look like a failed insert even though the row saved.
  const { error } = await db.from(TABLE).insert(person);
  if (error) throw new Error(error.message);
  return person;
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

// Every food is shared, so all profiles see the same list. person_id is kept
// on the row only so food added before this change still loads.
export async function listFoods() {
  const db = await getClient();
  if (!db) return readFoodsLocal();

  const { data, error } = await db
    .from(FOOD_TABLE)
    .select("id, person_id, name, image_url, expires_on, description, allergens, created_at")
    .order("expires_on", { ascending: true });

  if (error) {
    // Falling back silently would look like an empty cupboard, so only do it
    // when there is actually something local to show.
    const local = readFoodsLocal();
    if (local.length) {
      console.warn("Supabase read failed, using local copy:", error.message);
      return local;
    }
    throw new Error(error.message);
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

  const { error } = await db.from(FOOD_TABLE).insert(row);
  if (error) throw new Error(error.message);
  return row;
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
