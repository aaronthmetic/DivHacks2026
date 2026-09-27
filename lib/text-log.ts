// Each person's text thread with barter, kept 14 days as context for the assistant.
import type { Db } from "mongodb";
import { logAuthFailure } from "./auth-errors";
import type { Messenger } from "./texting";

export type TextRole = "person" | "barter";
export type LoggedText = { role: TextRole; text: string; createdAt: Date };

const TEXT_LOG_TTL_SECONDS = 14 * 24 * 60 * 60;
/** How much of each text the log keeps. The assistant gives the model no more of the text it answers. */
export const MAX_TEXT_LENGTH = 2000;

type StoredText = { phoneNumber: string; role: TextRole; text: string; createdAt: Date };
const texts = (db: Db) => db.collection<StoredText>("textMessage");

export async function ensureTextLogIndexes(db: Db): Promise<void> {
  await Promise.all([
    texts(db).createIndex({ createdAt: 1 }, { expireAfterSeconds: TEXT_LOG_TTL_SECONDS }),
    texts(db).createIndex({ phoneNumber: 1, createdAt: -1 }),
  ]);
}

export async function logText(db: Db, phoneNumber: string, role: TextRole, text: string, now = new Date()): Promise<void> {
  await texts(db).insertOne({ phoneNumber, role, text: text.slice(0, MAX_TEXT_LENGTH), createdAt: now });
}

/** The latest texts in the person's thread, oldest first. */
export async function recentTexts(db: Db, phoneNumber: string, limit = 20): Promise<LoggedText[]> {
  const rows = await texts(db).find({ phoneNumber }).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
  return rows.reverse().map(({ role, text, createdAt }) => ({ role, text, createdAt }));
}

/** How many texts the person sent to barter since `since`. */
export async function countTextsFrom(db: Db, phoneNumber: string, since: Date): Promise<number> {
  return texts(db).countDocuments({ phoneNumber, role: "person", createdAt: { $gte: since } });
}

/** Wraps a messenger so every text barter sends is logged. */
export function loggingMessenger(db: Db, messenger: Messenger): Messenger {
  return {
    async send(phoneNumber, text) {
      await messenger.send(phoneNumber, text);
      try {
        await logText(db, phoneNumber, "barter", text);
      } catch (error) {
        logAuthFailure("Text log", error);
      }
    },
  };
}
