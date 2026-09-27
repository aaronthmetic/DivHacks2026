// Each person's text thread with barter, kept 14 days as context for the assistant.
// STUB: signatures are final; the text log task implements them. Until then they do nothing.
import type { Db } from "mongodb";
import type { Messenger } from "./texting";

export type TextRole = "person" | "barter";
export type LoggedText = { role: TextRole; text: string; createdAt: Date };

export async function ensureTextLogIndexes(db: Db): Promise<void> {
  void db;
}

export async function logText(db: Db, phoneNumber: string, role: TextRole, text: string, now = new Date()): Promise<void> {
  void db; void phoneNumber; void role; void text; void now;
}

/** The latest texts in the person's thread, oldest first. */
export async function recentTexts(db: Db, phoneNumber: string, limit = 20): Promise<LoggedText[]> {
  void db; void phoneNumber; void limit;
  return [];
}

/** How many texts the person sent to barter since `since`. */
export async function countTextsFrom(db: Db, phoneNumber: string, since: Date): Promise<number> {
  void db; void phoneNumber; void since;
  return 0;
}

/** Wraps a messenger so every text barter sends is logged. */
export function loggingMessenger(db: Db, messenger: Messenger): Messenger {
  void db;
  return messenger;
}
