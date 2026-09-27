import { MongoServerError, type Db, type ObjectId } from "mongodb";
import { InputError, isProfileComplete } from "./auth-validation";
import type { RegisterPhoton } from "./photon-users";

/** Sends one text. The real one wraps Photon (lib/photon-messenger.ts); tests pass a fake. */
export interface Messenger { send(phoneNumber: string, text: string): Promise<void> }

// Incoming Photon message IDs are kept a week, so at-least-once webhook deliveries are handled once.
const MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;
const messages = (db: Db) => db.collection<{ _id: string; receivedAt: Date }>("photonMessage");

export async function ensureTextingIndexes(db: Db) {
  await messages(db).createIndex({ receivedAt: 1 }, { expireAfterSeconds: MESSAGE_TTL_SECONDS });
}

/** Registers a complete user with Photon once and returns the barter number they text. */
export async function ensurePhotonUser(db: Db, userId: ObjectId, register: RegisterPhoton): Promise<string> {
  const user = await db.collection("user").findOne({ _id: userId });
  if (!user || !isProfileComplete({ firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, profileCompletedAt: user.profileCompletedAt })) throw new InputError("Complete your profile to continue.");
  if (typeof user.photonNumber === "string") return user.photonNumber;
  const registered = await register({ phoneNumber: user.phoneNumber, firstName: user.firstName, lastName: user.lastName });
  // Matching the phone too means a number changed meanwhile isn't paired with the old registration.
  await db.collection("user").updateOne({ _id: userId, phoneNumber: user.phoneNumber }, { $set: { photonUserId: registered.id, photonNumber: registered.assignedPhoneNumber } });
  return registered.assignedPhoneNumber;
}

/** Records the first text from this phone. True only the first time. */
export async function enableTexts(db: Db, phoneNumber: string) {
  const result = await db.collection("user").updateOne({ phoneNumber, textsEnabledAt: { $exists: false } }, { $set: { textsEnabledAt: new Date() } });
  return result.modifiedCount === 1;
}

/** Claims an incoming message ID. False when it was already handled. */
export async function claimInboundMessage(db: Db, messageId: string) {
  try {
    await messages(db).insertOne({ _id: messageId, receivedAt: new Date() });
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}
