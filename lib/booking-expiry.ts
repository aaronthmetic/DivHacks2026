// Cancels requests nobody answered within 48 hours, which returns the held coins.
// STUB: the signature is final; the expiry task implements it.
import type { Db, MongoClient } from "mongodb";
import type { Messenger } from "./texting";

export const REQUEST_LIFETIME_MS = 48 * 60 * 60 * 1000;

/** Expires up to `limit` stale requests and texts both people; returns how many it cancelled. Safe to run twice or concurrently. */
export async function expireStaleRequests(db: Db, client: MongoClient, messenger: Messenger, now = new Date(), limit = 50): Promise<number> {
  void db; void client; void messenger; void now; void limit;
  return 0;
}
