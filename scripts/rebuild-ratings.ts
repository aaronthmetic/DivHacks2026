import { MongoClient } from "mongodb";
import { rebuildAllUserRatings } from "../lib/review-ratings";

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new Error("Set MONGODB_URI and MONGODB_DB in .env.local.");
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const usersUpdated = await rebuildAllUserRatings(client.db(process.env.MONGODB_DB));
    console.log(JSON.stringify({ usersUpdated }));
  } finally { await client.close(); }
}
main().catch(error => {
  console.error("Rating rebuild failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
