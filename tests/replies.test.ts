import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { handleInboundText, parseReply, type InboundDeps } from "../lib/booking-replies";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, bookingCode, whichOneText } from "../lib/booking-texts";
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
// A messenger whose send() throws whenever `throwsOn` matches the text, to check handleInboundText's outer catch.
function throwingMessenger(throwsOn: (text: string) => boolean) {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) {
    if (throwsOn(text)) throw new Error("messenger boom");
    sent.push({ phone, text });
  } };
}
// Records calls to the assistant without running one, so routing can be tested without a real LLM.
function fakeCoordinate() {
  const calls: { sender: Parameters<NonNullable<InboundDeps["coordinate"]>>[3]; text: string }[] = [];
  const fn: NonNullable<InboundDeps["coordinate"]> = async (_db, _messenger, _llm, sender, text) => { calls.push({ sender, text }); };
  return { calls, fn };
}
// Records calls to the expiry sweep; `throws` simulates it failing.
function fakeExpire({ throws = false } = {}) {
  const calls: Date[] = [];
  const fn: NonNullable<InboundDeps["expire"]> = async (_db, _client, _messenger, now = new Date()) => {
    calls.push(now);
    if (throws) throw new Error("expiry boom");
    return 0;
  };
  return { calls, fn };
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
    { phone: emily.phone, text: 'barter: You accepted Barry\'s Guitar Lessons request. What time on Sat 10 AM–2 PM works for you, and how will you meet? Reply like "Sat 10 AM on Zoom".' },
    { phone: barry.phone, text: "barter: Emily accepted your Guitar Lessons request! We'll text you when Emily suggests a time and place." },
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
  // Emily now has an accepted booking (first) and no requests waiting: a bare "yes" reaches the
  // assistant instead of Part A's "no requests waiting" (Part B's routing change).
  texts.sent.length = 0;
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "yes" }, { coordinate: assistant.fn });
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: `yes ${bookingCode(second._id)}` }, { coordinate: assistant.fn });
  assert.equal(assistant.calls.length, 1);
  assert.equal(assistant.calls[0].text, "yes");
  assert.equal(assistant.calls[0].sender.phoneNumber, emily.phone);
  assert.deepEqual(texts.sent.map((text) => text.text), [ALREADY_ANSWERED_TEXT]);
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

test("free text from a requester with an accepted booking reaches the assistant", async () => {
  const barry = await person(20, "Barry2"), emily = await person(21, "Emily2");
  const booking = await request(barry.id, emily.id);
  await createExchangeService(db, client).transitionBooking(emily.id, booking._id, "accept");
  const texts = messenger();
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: barry.phone, text: "Sat 11 AM works" }, { coordinate: assistant.fn });
  assert.equal(assistant.calls.length, 1);
  assert.equal(assistant.calls[0].sender._id.toString(), barry.id.toString());
  assert.equal(assistant.calls[0].sender.firstName, "Barry2");
  assert.equal(assistant.calls[0].sender.phoneNumber, barry.phone);
  assert.equal(assistant.calls[0].text, "Sat 11 AM works");
  assert.equal(texts.sent.length, 0);
});

test("a bare yes accepts a waiting request even when the sender also has an accepted booking", async () => {
  const provider = await person(22, "ProviderB"), requesterA = await person(23, "RequesterA"), requesterB = await person(24, "RequesterB");
  const waiting = await request(requesterA.id, provider.id, "Tutoring");
  const active = await request(requesterB.id, provider.id, "Piano Lessons");
  await createExchangeService(db, client).transitionBooking(provider.id, active._id, "accept");
  const texts = messenger();
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: provider.phone, text: "yes" }, { coordinate: assistant.fn });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: waiting._id }))?.status, "accepted");
  assert.equal(assistant.calls.length, 0);
});

test("YES with a code still goes to Part A even with an accepted booking present", async () => {
  const provider = await person(25, "ProviderC"), requesterA = await person(26, "RequesterC"), requesterB = await person(27, "RequesterD");
  const waiting = await request(requesterA.id, provider.id, "Tutoring");
  const active = await request(requesterB.id, provider.id, "Piano Lessons");
  await createExchangeService(db, client).transitionBooking(provider.id, active._id, "accept");
  const texts = messenger();
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: provider.phone, text: `yes ${bookingCode(waiting._id)}` }, { coordinate: assistant.fn });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: waiting._id }))?.status, "accepted");
  assert.equal(assistant.calls.length, 0);
});

test("free text with no active booking gets HELP_TEXT", async () => {
  const solo = await person(28, "SoloD");
  const texts = messenger();
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: solo.phone, text: "hello there" }, { coordinate: assistant.fn });
  assert.deepEqual(texts.sent, [{ phone: solo.phone, text: HELP_TEXT }]);
  assert.equal(assistant.calls.length, 0);
});

test("a bare yes with no bookings at all still goes to Part A for no requests waiting", async () => {
  const solo = await person(31, "SoloG");
  const texts = messenger();
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: solo.phone, text: "yes" }, { coordinate: assistant.fn });
  assert.deepEqual(texts.sent, [{ phone: solo.phone, text: NO_REQUESTS_TEXT }]);
  assert.equal(assistant.calls.length, 0);
});

test("expiry runs on each handled text but not for unknown senders or the first text", async () => {
  const newcomer = await person(29, "NewcomerE", false);
  const texts = messenger();
  const expiry = fakeExpire();
  await handleInboundText(db, client, texts, { senderPhone: "+12025550999", text: "YES" }, { expire: expiry.fn });
  assert.equal(expiry.calls.length, 0);
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "Hi barter!" }, { expire: expiry.fn });
  assert.equal(expiry.calls.length, 0);
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "second text" }, { expire: expiry.fn });
  assert.equal(expiry.calls.length, 1);
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "third text" }, { expire: expiry.fn });
  assert.equal(expiry.calls.length, 2);
});

test("an expire that throws doesn't stop routing", async () => {
  const solo = await person(30, "SoloF");
  const texts = messenger();
  const expiry = fakeExpire({ throws: true });
  await handleInboundText(db, client, texts, { senderPhone: solo.phone, text: "hello there" }, { expire: expiry.fn });
  assert.equal(expiry.calls.length, 1);
  assert.deepEqual(texts.sent, [{ phone: solo.phone, text: HELP_TEXT }]);
});

test("handleInboundText resolves instead of throwing when the messenger fails sending the help text", async () => {
  const solo = await person(40, "SoloI");
  const texts = throwingMessenger((text) => text === HELP_TEXT);
  await assert.doesNotReject(handleInboundText(db, client, texts, { senderPhone: solo.phone, text: "hello there" }));
  assert.equal(texts.sent.length, 0);
});

test("handleInboundText resolves instead of throwing when the messenger fails sending a Part A reply", async () => {
  const barry = await person(41, "Barry8"), emily = await person(42, "Emily8");
  const first = await request(barry.id, emily.id);
  // The transition itself must still succeed even though the confirmation text after it fails to send.
  const texts = throwingMessenger((text) => text.includes("You accepted"));
  await assert.doesNotReject(handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "Yes" }));
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: first._id }))?.status, "accepted");
});

// Emily has Sam's request waiting and, on an accepted booking, Barry's (or Emily's own) suggested time.
async function overlap(numbers: [number, number, number], suggestedBy: "provider" | "other") {
  const emily = await person(numbers[0], "Emily"), sam = await person(numbers[1], "Sam"), barry = await person(numbers[2], "Barry");
  const waiting = await request(sam.id, emily.id, "Piano Lessons");
  const active = await request(barry.id, emily.id, "Guitar Lessons");
  await createExchangeService(db, client).transitionBooking(emily.id, active._id, "accept");
  const byUserId = suggestedBy === "other" ? barry.id : emily.id;
  await exchangeCollections(db).bookings.updateOne({ _id: active._id }, { $set: { proposal: { startsAt: new Date(Date.now() + 86_400_000), byUserId, createdAt: new Date() } } });
  return { emily, waiting };
}

test("a bare YES or NO asks which one when a request and the other person's suggested time both wait on the sender", async () => {
  const { emily, waiting } = await overlap([50, 51, 52], "other");
  const texts = messenger();
  const assistant = fakeCoordinate();
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "No." }, { coordinate: assistant.fn });
  const code = bookingCode(waiting._id);
  assert.deepEqual(texts.sent, [{ phone: emily.phone, text: whichOneText({ requesterFirstName: "Sam", requestTitle: "Piano Lessons", code, suggestedBy: "Barry", suggestionTitle: "Guitar Lessons" }) }]);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: waiting._id }))?.status, "requested");
  assert.equal(assistant.calls.length, 0);
  // With the code, the reply answers the request.
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: `no ${code}` }, { coordinate: assistant.fn });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: waiting._id }))?.status, "declined");
});

test("a bare YES answers the request when the only suggestion waiting is the sender's own", async () => {
  const { emily, waiting } = await overlap([53, 54, 55], "provider");
  await handleInboundText(db, client, messenger(), { senderPhone: emily.phone, text: "yes" }, { coordinate: fakeCoordinate().fn });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: waiting._id }))?.status, "accepted");
});
