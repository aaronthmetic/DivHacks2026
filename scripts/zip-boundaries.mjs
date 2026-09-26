// Regenerates lib/barter/zip-boundaries.json (zip outlines for the map) from
// NYC Open Data's ZIP code tabulation areas, and prints each zip's official
// center point for lib/barter/data.ts.
// Usage: node scripts/zip-boundaries.mjs 10024 10025 10026
import { writeFileSync } from "node:fs";

const zips = process.argv.slice(2);
if (!zips.length || !zips.every((zip) => /^\d{5}$/.test(zip))) {
  console.error("Usage: node scripts/zip-boundaries.mjs <zip> [zip...]");
  process.exit(1);
}

const url = new URL("https://data.cityofnewyork.us/resource/35j5-n34v.json");
url.searchParams.set("$select", "zcta5,intptlat,intptlon,the_geom");
url.searchParams.set(
  "$where",
  `zcta5 in(${zips.map((zip) => `'${zip}'`).join(",")})`,
);

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`NYC Open Data returned ${response.status}`);
}
const rows = await response.json();

// Five decimals is about a meter, which keeps the file small.
const round = (value) =>
  Array.isArray(value) ? value.map(round) : Math.round(value * 1e5) / 1e5;

const collection = {
  type: "FeatureCollection",
  features: rows.map((row) => ({
    type: "Feature",
    properties: { zip: row.zcta5 },
    geometry: {
      type: row.the_geom.type,
      coordinates: round(row.the_geom.coordinates),
    },
  })),
};

writeFileSync(
  new URL("../lib/barter/zip-boundaries.json", import.meta.url),
  `${JSON.stringify(collection)}\n`,
);

for (const row of rows) {
  console.log(
    `${row.zcta5}: lat ${round(Number(row.intptlat))}, lng ${round(Number(row.intptlon))}`,
  );
}
const missing = zips.filter((zip) => !rows.some((row) => row.zcta5 === zip));
console.log(
  `Wrote ${rows.length} zip boundaries${missing.length ? `; not found: ${missing.join(", ")}` : ""}.`,
);
