import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { handleInboundText, parseReply } from "../lib/booking-replies";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, bookingCode } from "../lib/booking-texts";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("replies");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "reply-test-secret-at-least-thirty-two-chars!" });
});
after(async () => { await client?.close(); await server?.stop(); });

async function person(number: number, firstName: string, texts = true) {
  const phone = `+12025550${String(600 + number)}`;
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName, lastName: "Tester", email: `replier${number}@example.com`, phoneNumber: phone, password: "reply-test-password!!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const id = new ObjectId((await response.json()).user.id);
  if (texts) await db.collection("user").updateOne({ _id: id }, { $set: { textsEnabledAt: new Date() } });
  return { id, phone };
}
async function request(requesterId: ObjectId, providerId: ObjectId, title = "Guitar Lessons") {
  const domain = createExchangeService(db, client);
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  const service = await domain.createService(providerId, { genreId, title, description: "Lessons.", deliveryMode: "remote", pricingType: "fixed", creditRate: 100, status: "active", availability: [saturday] });
  return domain.requestBooking(requesterId, service._id, { preferredWindow: saturday });
}
function messenger() {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { sent.push({ phone, text }); } };
}

test("replies are YES or NO with an optional code", () => {
  assert.deepEqual(parseReply("yes"), { answer: "yes" });
  assert.deepEqual(parseReply("  Yes! "), { answer: "yes" });
  assert.deepEqual(parseReply("ACCEPT 7f3a"), { answer: "yes", code: "7F3A" });
  assert.deepEqual(parseReply("n #19C2"), { answer: "no", code: "19C2" });
  assert.deepEqual(parseReply("decline AA7F3A."), { answer: "no", code: "AA7F3A" });
  for (const text of ["yes please", "maybe", "no 7F3", "yes 1234567", ""]) assert.equal(parseReply(text), null, text);
});

test("the first text turns texts on; later chatter gets help", async () => {
  const newcomer = await person(1, "Nia", false);
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "Hi barter!" });
  assert.ok((await db.collection("user").findOne({ _id: newcomer.id }))?.textsEnabledAt instanceof Date);
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "what's up" });
  await handleInboundText(db, client, texts, { senderPhone: "+12025550999", text: "YES" });
  assert.deepEqual(texts.sent, [{ phone: newcomer.phone, text: WELCOME_TEXT }, { phone: newcomer.phone, text: HELP_TEXT }]);
});

test("YES accepts the only waiting request and NO declines with a refund", async () => {
  const barry = await person(2, "Barry"), emily = await person(3, "Emily");
  const first = await request(barry.id, emily.id);
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "Yes" });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: first._id }))?.status, "accepted");
  assert.deepEqual(texts.sent, [
    { phone: emily.phone, text: "barter: You accepted Barry's Guitar Lessons request. We'll help you both pick a time and place next." },
    { phone: barry.phone, text: "barter: Emily accepted your Guitar Lessons request! We'll help you both pick a time and place next." },
  ]);
  const second = await request(barry.id, emily.id, "Piano Lessons");
  texts.sent.length = 0;
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "no" });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: second._id }))?.status, "declined");
  assert.equal((await exchangeCollections(db).accounts.findOne({ userId: barry.id }))?.heldCredits, 100);
  assert.deepEqual(texts.sent.map((text) => text.text), [
    "barter: You declined Barry's Piano Lessons request.",
    "barter: Emily can't take your Piano Lessons request this time. Your 1 coin is back in your balance.",
  ]);
  texts.sent.length = 0;
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "yes" });
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: `yes ${bookingCode(second._id)}` });
  assert.deepEqual(texts.sent.map((text) => text.text), [NO_REQUESTS_TEXT, ALREADY_ANSWERED_TEXT]);
});

test("with several requests waiting, the code picks one", async () => {
  const sam = await person(4, "Sam"), lou = await person(5, "Lou"), ana = await person(6, "Ana");
  const guitar = await request(sam.id, ana.id), piano = await request(lou.id, ana.id, "Piano Lessons");
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: ana.phone, text: "YES" });
  assert.deepEqual(texts.sent, [{ phone: ana.phone, text: `barter: You have 2 requests waiting: Guitar Lessons from Sam (${bookingCode(guitar._id)}), Piano Lessons from Lou (${bookingCode(piano._id)}). Reply YES or NO with the code, like "YES ${bookingCode(guitar._id)}".` }]);
  await handleInboundText(db, client, texts, { senderPhone: ana.phone, text: `YES ${bookingCode(piano._id).toLowerCase()}` });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: piano._id }))?.status, "accepted");
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: guitar._id }))?.status, "requested");
});

test("codes that collide are listed with six characters", async () => {
  const kim = await person(7, "Kim"), jo = await person(8, "Jo");
  const template = await request(kim.id, jo.id);
  const bookings = exchangeCollections(db).bookings;
  await bookings.deleteOne({ _id: template._id });
  const { _id: _unused, ...fields } = template;
  void _unused;
  const a = new ObjectId("aaaaaaaaaaaaaaaaaaaa7f3a"), b = new ObjectId("bbbbbbbbbbbbbbbbbbbb7f3a");
  await bookings.insertMany([{ ...fields, _id: a }, { ...fields, _id: b }]);
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: jo.phone, text: "yes 7F3A" });
  assert.deepEqual(texts.sent.map((text) => text.text), ["barter: You have 2 requests waiting: Guitar Lessons from Kim (AA7F3A), Guitar Lessons from Kim (BB7F3A). Reply YES or NO with the code, like \"YES AA7F3A\"."]);
  await handleInboundText(db, client, texts, { senderPhone: jo.phone, text: "yes bb7f3a" });
  assert.equal((await bookings.findOne({ _id: b }))?.status, "accepted");
  assert.equal((await bookings.findOne({ _id: a }))?.status, "requested");
});
