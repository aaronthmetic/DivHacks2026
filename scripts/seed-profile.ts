import { MongoClient } from "mongodb";
import { seedProfile } from "../lib/profile-seed";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { ensureExchangeIndexes } from "../lib/exchange-schema";
import { getProfileData } from "../lib/profile-data";

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new Error("Set MONGODB_URI and MONGODB_DB in .env.local.");
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB);
    await ensureAuthIndexes(db); await ensureExchangeIndexes(db);
    const result = await seedProfile(db, client, process.argv[2] ?? "john.doe@email.com");
    const owner = await getProfileData(db, result.userId, result.userId, "1");
    const visitor = await getProfileData(db, result.userId, result.providerId, "1");
    console.log(JSON.stringify({ ...result, display: { ownerListings: owner?.listings.length, ownerBookings: owner?.bookings.length, visitorListings: visitor?.listings.length, visitorBookings: visitor?.bookings.length, bookingOrder: owner?.bookings.map(b => b.title) } }, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Profile seed failed:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; });
