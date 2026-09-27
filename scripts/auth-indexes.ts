import { AuthConfigurationError, logAuthFailure } from "../lib/auth-errors";
import { ensureDefaultGenres, ensureExchangeIndexes } from "../lib/exchange-schema";
import { MongoClient } from "mongodb";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { ensureTextLogIndexes } from "../lib/text-log";
import { ensureTextingIndexes } from "../lib/texting";

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new AuthConfigurationError("Set MONGODB_URI and MONGODB_DB in .env.local.");
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    await ensureAuthIndexes(client.db(process.env.MONGODB_DB));
    await ensureExchangeIndexes(client.db(process.env.MONGODB_DB));
    await ensureDefaultGenres(client.db(process.env.MONGODB_DB));
    await ensureTextingIndexes(client.db(process.env.MONGODB_DB));
    await ensureTextLogIndexes(client.db(process.env.MONGODB_DB));
    console.log("Authentication, exchange, texting and text log indexes and default categories are ready.");
  } finally { await client.close(); }
}
main().catch((error) => { logAuthFailure("Index setup: check connectivity, permissions, and duplicate identifiers", error); process.exitCode = 1; });
