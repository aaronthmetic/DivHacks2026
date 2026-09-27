import { ensureDefaultGenres, ensureExchangeIndexes } from "./exchange-schema";
import "server-only";
import { AuthConfigurationError, logAuthFailure } from "./auth-errors";
import { MongoClient } from "mongodb";
import { ensureAuthIndexes } from "./auth-indexes";

const globalMongo = globalThis as typeof globalThis & {
  authMongo?: Promise<{ client: MongoClient; db: ReturnType<MongoClient["db"]> }>;
};

export function getMongo() {
  if (!globalMongo.authMongo) {
    globalMongo.authMongo = (async () => {
      if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new AuthConfigurationError("Set both MONGODB_URI and MONGODB_DB.");
      const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB);
        await ensureAuthIndexes(db);
        // `npm run db:indexes` also installs these. The exchange domain must not be able to
        // take authentication down, so its index build runs in the background and only logs.
        void ensureExchangeIndexes(db).catch((error) => logAuthFailure("Exchange index setup", error));
        void ensureDefaultGenres(db).catch((error) => logAuthFailure("Default category setup", error));
        return { client, db };
      } catch (error) {
        await client.close();
        throw error;
      }
    })().catch((error) => {
      globalMongo.authMongo = undefined;
      throw error;
    });
  }
  return globalMongo.authMongo;
}