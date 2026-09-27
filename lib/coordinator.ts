// The assistant that helps two people agree on an accepted booking's time and place by text.
// Spec: docs/superpowers/specs/2026-09-27-photon-coordination-design.md
// STUB: the signature is final; the assistant task implements it.
import type { Db, ObjectId } from "mongodb";
import type { Llm } from "./llm";
import type { Messenger } from "./texting";

export type Sender = { _id: ObjectId; firstName: string; phoneNumber: string };

/** Handles one text from a person with an active booking. Never throws: failures are logged and the sender gets an apology. */
export async function coordinate(db: Db, messenger: Messenger, llm: Llm | null, sender: Sender, text: string, now = new Date()): Promise<void> {
  void db; void messenger; void llm; void sender; void text; void now;
}
