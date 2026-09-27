import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { handleInboundText } from "../lib/booking-replies";
import { acceptedTexts, bookingCode, confirmedText, expiredTexts, proposalText } from "../lib/booking-texts";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";
import type { AssistantMessage, ChatMessage, Llm } from "../lib/llm";
import { getProfileData } from "../lib/profile-data";
import { ensureTextLogIndexes, loggingMessenger, recentTexts } from "../lib/text-log";

// Part B end to end with a scripted model: YES, a proposal, OK, and the booking is scheduled.
let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };
const now = new Date("2026-09-28T14:00:00Z"); // Monday, 10 AM in New York

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("coordination_flow");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db); await ensureTextLogIndexes(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "flow-test-secret-at-least-thirty-two-chars!!" });
});
after(async () => { await client?.close(); await server?.stop(); });

async function person(number: number, firstName: string) {
  const phone = `+12025550${String(600 + number)}`;
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName, lastName: "Tester", email: `flow${number}@example.com`, phoneNumber: phone, password: "flow-test-password!!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const id = new ObjectId((await response.json()).user.id);
  await db.collection("user").updateOne({ _id: id }, { $set: { textsEnabledAt: new Date() } });
  return { id, phone };
}

async function request(requesterId: ObjectId, providerId: ObjectId, createdAt?: Date) {
  const domain = createExchangeService(db, client);
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  const service = await domain.createService(providerId, { genreId, title: "Guitar Lessons", description: "Beginner lessons.", deliveryMode: "in_person", zipCode: "10027", countryCode: "US", pricingType: "fixed", creditRate: 100, status: "active", availability: [saturday] });
  const booking = await domain.requestBooking(requesterId, service._id, { preferredWindow: saturday });
  if (createdAt) await exchangeCollections(db).bookings.updateOne({ _id: booking._id }, { $set: { createdAt } });
  return booking;
}

function messenger() {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { sent.push({ phone, text }); } };
}

// Returns the scripted replies in order and records what the model was sent.
function scriptedLlm(replies: AssistantMessage[]) {
  const calls: ChatMessage[][] = [];
  const llm: Llm = {
    async chat(messages) {
      calls.push(structuredClone(messages));
      const reply = replies.shift();
      assert.ok(reply, "the model was called more often than scripted");
      return reply;
    },
  };
  return { llm, calls };
}
const toolCall = (name: string, args: object): AssistantMessage => ({ role: "assistant", content: null, tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const say = (content: string): AssistantMessage => ({ role: "assistant", content });

test("a proposal confirmed by the other person schedules the booking and shows on the profile", async () => {
  const barry = await person(1, "Barry"), emily = await person(2, "Emily");
  const booking = await request(barry.id, emily.id);
  const code = bookingCode(booking._id);
  const texts = messenger();
  const via = loggingMessenger(db, texts);

  await handleInboundText(db, client, via, { senderPhone: emily.phone, text: "Yes" }, { now });
  const accepted = acceptedTexts({ title: "Guitar Lessons", requesterFirstName: "Barry", providerFirstName: "Emily", window: saturday, deliveryMode: "in_person" });
  assert.deepEqual(texts.sent, [{ phone: emily.phone, text: accepted.provider }, { phone: barry.phone, text: accepted.requester }]);

  texts.sent.length = 0;
  const emilyModel = scriptedLlm([toolCall("propose_time", { code, starts_at: "2026-10-03T11:00", place: "Butler Library" }), say("Sent to Barry. I'll text you when Barry answers.")]);
  await handleInboundText(db, client, via, { senderPhone: emily.phone, text: "Sat 11 AM at Butler Library" }, { llm: emilyModel.llm, now });
  const when = "Sat, Oct 3 at 11 AM";
  assert.deepEqual(texts.sent, [
    { phone: barry.phone, text: proposalText({ fromFirstName: "Emily", title: "Guitar Lessons", when, place: "Butler Library" }) },
    { phone: emily.phone, text: "barter: Sent to Barry. I'll text you when Barry answers." },
  ]);
  // The model sees the booking but never a phone number.
  const prompt = JSON.stringify(emilyModel.calls[0]);
  assert.ok(prompt.includes(code) && prompt.includes("Guitar Lessons") && prompt.includes("Barry"), prompt);
  assert.ok(!prompt.includes(barry.phone.slice(2)) && !prompt.includes(emily.phone.slice(2)), prompt);

  texts.sent.length = 0;
  const barryModel = scriptedLlm([toolCall("confirm_time", { code }), say("Done! You're set for Saturday.")]);
  await handleInboundText(db, client, via, { senderPhone: barry.phone, text: "OK" }, { llm: barryModel.llm, now });
  for (const expected of [
    { phone: barry.phone, text: confirmedText({ otherFirstName: "Emily", title: "Guitar Lessons", when, place: "Butler Library" }) },
    { phone: emily.phone, text: confirmedText({ otherFirstName: "Barry", title: "Guitar Lessons", when, place: "Butler Library" }) },
  ]) assert.ok(texts.sent.some((sent) => sent.phone === expected.phone && sent.text === expected.text), expected.text);
  assert.deepEqual(texts.sent.at(-1), { phone: barry.phone, text: "barter: Done! You're set for Saturday." });

  const saved = (await exchangeCollections(db).bookings.findOne({ _id: booking._id }))!;
  assert.equal(saved.scheduledAt?.toISOString(), "2026-10-03T15:00:00.000Z");
  assert.equal(saved.place, "Butler Library");
  assert.equal(saved.proposal, undefined);

  const profile = (await getProfileData(db, barry.id.toHexString(), barry.id.toHexString(), "1"))!;
  const card = profile.bookings.find((item) => item.id === booking._id.toHexString())!;
  assert.deepEqual(card.lines.slice(0, 2), [when, "At Butler Library"]);

  // Both sides of each thread are logged as the assistant's context.
  const thread = await recentTexts(db, barry.phone);
  assert.ok(thread.some((entry) => entry.role === "person" && entry.text === "OK"));
  assert.ok(thread.some((entry) => entry.role === "barter" && entry.text.startsWith("barter: Emily suggests")));
});

test("an incoming text expires requests nobody answered within 48 hours", async () => {
  const sam = await person(3, "Sam"), ana = await person(4, "Ana");
  const stale = await request(sam.id, ana.id, new Date(now.getTime() - 49 * 3_600_000));
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: sam.phone, text: "hello" }, { now });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: stale._id }))?.status, "cancelled");
  assert.equal((await exchangeCollections(db).accounts.findOne({ userId: sam.id }))?.heldCredits, 0);
  const expired = expiredTexts({ title: "Guitar Lessons", requesterFirstName: "Sam", providerFirstName: "Ana", totalCredits: stale.totalCredits });
  assert.ok(texts.sent.some((sent) => sent.phone === sam.phone && sent.text === expired.requester));
  assert.ok(texts.sent.some((sent) => sent.phone === ana.phone && sent.text === expired.provider));
});
