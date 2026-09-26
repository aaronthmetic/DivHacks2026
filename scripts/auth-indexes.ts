import { ensureExchangeIndexes } from "../lib/exchange-schema";
import { MongoClient } from "mongodb";
import { ensureAuthIndexes } from "../lib/auth-indexes";

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new Error("Set MONGODB_URI and MONGODB_DB in .env.local.");
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    await ensureAuthIndexes(client.db(process.env.MONGODB_DB));
    await ensureExchangeIndexes(client.db(process.env.MONGODB_DB));
    console.log("Authentication and exchange indexes are ready.");
  } finally { await client.close(); }
}
main().catch(() => { console.error("Index setup failed. Check MongoDB connectivity, permissions, and duplicate identifiers."); process.exitCode = 1; });
