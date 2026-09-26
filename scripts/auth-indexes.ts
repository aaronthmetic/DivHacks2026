import { AuthConfigurationError, logAuthFailure } from "../lib/auth-errors";
import { ensureExchangeIndexes } from "../lib/exchange-schema";
import { MongoClient } from "mongodb";
import { ensureAuthIndexes } from "../lib/auth-indexes";

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new AuthConfigurationError("Set MONGODB_URI and MONGODB_DB in .env.local.");
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    await ensureAuthIndexes(client.db(process.env.MONGODB_DB));
    await ensureExchangeIndexes(client.db(process.env.MONGODB_DB));
    console.log("Authentication and exchange indexes are ready.");
  } finally { await client.close(); }
}
main().catch((error) => { logAuthFailure("Index setup: check connectivity, permissions, and duplicate identifiers", error); process.exitCode = 1; });
