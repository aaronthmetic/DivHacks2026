import type { Db, Document, MongoClient, ObjectId, WithId } from "mongodb";
import { logAuthFailure } from "./auth-errors";
import { InputError } from "./auth-validation";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, acceptedTexts, bookingCode, declinedTexts, waitingListText } from "./booking-texts";
import { expireStaleRequests } from "./booking-expiry";
import { coordinate } from "./coordinator";
import { exchangeCollections, type Booking } from "./exchange-schema";
import { createExchangeService } from "./exchange-service";
import type { Llm } from "./llm";
import { logText } from "./text-log";
import { enableTexts, type Messenger } from "./texting";

export type Reply = { answer: "yes" | "no"; code?: string };

const REPLY = /^(yes|y|accept|no|n|decline)(?:\s+#?([0-9a-f]{4,6}))?[.!?]*$/i;

/** "Yes!", "YES 7f3a" and "no #7F3A" are replies; anything else is null. */
export function parseReply(text: string): Reply | null {
  const match = REPLY.exec(text.trim());
  if (!match) return null;
  const answer = ["yes", "y", "accept"].includes(match[1].toLowerCase()) ? "yes" : "no";
  return match[2] ? { answer, code: match[2].toUpperCase() } : { answer };
}

export type InboundDeps = { llm?: Llm | null; now?: Date; coordinate?: typeof coordinate; expire?: typeof expireStaleRequests };

// Whether the sender (as provider) has a request still waiting for a YES/NO answer.
const hasWaitingRequest = (db: Db, providerId: ObjectId) =>
  exchangeCollections(db).bookings.findOne({ providerId, status: "requested" }, { projection: { _id: 1 } }).then(Boolean);
// Whether the sender, as either side, has an accepted booking the assistant can coordinate.
const hasActiveBooking = (db: Db, userId: ObjectId) =>
  exchangeCollections(db).bookings.findOne({ status: "accepted", $or: [{ providerId: userId }, { requesterId: userId }] }, { projection: { _id: 1 } }).then(Boolean);

// Handles one incoming text. Never throws: Photon won't retry after the webhook's 200, so failures are logged.
export async function handleInboundText(db: Db, client: MongoClient, messenger: Messenger, { senderPhone, text }: { senderPhone: string; text: string }, deps: InboundDeps = {}) {
  try {
    const user = await db.collection("user").findOne({ phoneNumber: senderPhone });
    if (!user) { logAuthFailure("Text from a number without a barter account"); return; }
    if (await enableTexts(db, senderPhone)) { await messenger.send(senderPhone, WELCOME_TEXT); return; }
    const now = deps.now ?? new Date();
    try {
      await (deps.expire ?? expireStaleRequests)(db, client, messenger, now);
    } catch (error) {
      logAuthFailure("Request expiry", error);
    }
    try {
      await logText(db, senderPhone, "person", text, now);
    } catch (error) {
      logAuthFailure("Text log", error);
    }
    const reply = parseReply(text);
    if (reply && (reply.code || await hasWaitingRequest(db, user._id))) return answer(db, client, messenger, user, reply);
    if (await hasActiveBooking(db, user._id)) {
      return (deps.coordinate ?? coordinate)(db, messenger, deps.llm ?? null, { _id: user._id, firstName: String(user.firstName), phoneNumber: senderPhone }, text, now);
    }
    if (reply) return answer(db, client, messenger, user, reply);
    return messenger.send(senderPhone, HELP_TEXT);
  } catch (error) {
    logAuthFailure("Incoming text", error);
  }
}

type Person = WithId<Document>;
const hex = (booking: { _id: { toHexString(): string } }) => booking._id.toHexString().toUpperCase();

async function answer(db: Db, client: MongoClient, messenger: Messenger, provider: Person, reply: Reply) {
  const bookings = exchangeCollections(db).bookings;
  const phone = String(provider.phoneNumber);
  const waiting = await bookings.find({ providerId: provider._id, status: "requested" }).sort({ createdAt: 1, _id: 1 }).toArray();
  const matches = reply.code ? waiting.filter((booking) => hex(booking).endsWith(reply.code!)) : waiting;
  if (matches.length === 1) return decide(db, client, messenger, provider, matches[0], reply.answer);
  if (matches.length > 1) return messenger.send(phone, waitingListText(await listItems(db, matches)));
  if (reply.code) {
    const answered = await bookings.find({ providerId: provider._id, status: { $ne: "requested" } }, { projection: { _id: 1 } }).sort({ updatedAt: -1 }).limit(50).toArray();
    if (answered.some((booking) => hex(booking).endsWith(reply.code!))) return messenger.send(phone, ALREADY_ANSWERED_TEXT);
    if (waiting.length) return messenger.send(phone, waitingListText(await listItems(db, waiting)));
  }
  return messenger.send(phone, NO_REQUESTS_TEXT);
}

async function decide(db: Db, client: MongoClient, messenger: Messenger, provider: Person, booking: Booking, answer: "yes" | "no") {
  const phone = String(provider.phoneNumber);
  try {
    await createExchangeService(db, client).transitionBooking(provider._id as Booking["providerId"], booking._id, answer === "yes" ? "accept" : "decline");
  } catch (error) {
    // Another reply or a cancellation got there first.
    if (error instanceof InputError) return messenger.send(phone, ALREADY_ANSWERED_TEXT);
    throw error;
  }
  const requester = await db.collection("user").findOne({ _id: booking.requesterId });
  const names = { title: booking.serviceSnapshot.title, requesterFirstName: String(requester?.firstName ?? "the requester"), providerFirstName: String(provider.firstName) };
  const texts = answer === "yes"
    ? acceptedTexts({ ...names, window: booking.preferredWindow, deliveryMode: booking.serviceSnapshot.deliveryMode })
    : declinedTexts({ ...names, totalCredits: booking.totalCredits });
  await messenger.send(phone, texts.provider);
  if (typeof requester?.phoneNumber === "string") await messenger.send(requester.phoneNumber, texts.requester);
}

// Lists waiting requests with their codes, using six characters when two four-character codes collide.
async function listItems(db: Db, bookings: Booking[]) {
  const requesters = await db.collection("user").find({ _id: { $in: bookings.map((booking) => booking.requesterId) } }, { projection: { firstName: 1 } }).toArray();
  const firstName = new Map(requesters.map((requester) => [requester._id.toHexString(), String(requester.firstName)]));
  const short = bookings.map((booking) => bookingCode(booking._id));
  const length = new Set(short).size < short.length ? 6 : 4;
  return bookings.map((booking) => ({ title: booking.serviceSnapshot.title, requesterFirstName: firstName.get(booking.requesterId.toHexString()) ?? "someone", code: bookingCode(booking._id, length) }));
}
