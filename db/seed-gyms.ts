import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type GymRow = { name: string; chain: string; postal_code: string };

// Step 1: read & parse the CSV
function loadCsv(): GymRow[] {
  const path = resolve(process.cwd(), "db/singapore_gyms_list.csv");
  const text = readFileSync(path, "utf-8").trim();
  const [, ...lines] = text.split("\n"); // drop header row
  return lines.map((line) => {
    const [name, chain, postal] = line.split(",").map((c) => c.trim());
    return { name, chain, postal_code: postal };
  });
}

// Step 2: get a OneMap auth token
async function getOneMapToken(): Promise<string> {
  const res = await fetch("https://www.onemap.gov.sg/api/auth/post/getToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ONEMAP_EMAIL,
      password: process.env.ONEMAP_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`OneMap auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

// Step 3: geocode one postal code -> { lat, lng } | null 
async function geocode(
  postalCode: string,
  token: string,
): Promise<{ lat: number; lng: number } | null> {
  const url =
    `https://www.onemap.gov.sg/api/common/elastic/search` +
    `?searchVal=${encodeURIComponent(postalCode)}` +
    `&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn(`  ! HTTP ${res.status} for ${postalCode}`);
    return null;
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;

  const top = data.results[0];
  return { lat: parseFloat(top.LATITUDE), lng: parseFloat(top.LONGITUDE) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const gyms = loadCsv();
  const token = await getOneMapToken();
  console.log(`Loaded ${gyms.length} gyms. Geocoding…`);

  const failed: string[] = [];

  for (const gym of gyms) {
    const coords = await geocode(gym.postal_code, token);
    if (!coords) {
      failed.push(`${gym.name} (${gym.postal_code})`);
      console.warn(`  ✗ no coords: ${gym.name}`);
    }

    const { error } = await supabase.from("gyms").upsert(
      {
        name: gym.name,
        chain: gym.chain,
        postal_code: gym.postal_code,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
      },
      { onConflict: "name,postal_code" }, // matches the unique() constraint
    );
    if (error) console.error(`  DB error for ${gym.name}: ${error.message}`);

    await sleep(250);
  }

  console.log(`\nDone. ${gyms.length - failed.length} geocoded, ${failed.length} failed.`);
  if (failed.length) {
    console.log("Failed (fix postal code or set coords manually):");
    failed.forEach((f) => console.log("  - " + f));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});