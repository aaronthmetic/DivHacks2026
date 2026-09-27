import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { countTextsFrom, ensureTextLogIndexes, loggingMessenger, logText, recentTexts } from "../lib/text-log";

let server: MongoMemoryReplSet, client: MongoClient, db: Db;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("text_log");
  await ensureTextLogIndexes(db);
});
after(async () => { await client?.close(); await server?.stop(); });

function messenger(failFor?: string) {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { if (phone === failFor) throw new Error("Photon is down"); sent.push({ phone, text }); } };
}

test("recentTexts returns the latest entries, oldest first, and respects the limit", async () => {
  const phone = "+12025550701";
  for (let i = 0; i < 5; i++) await logText(db, phone, i % 2 === 0 ? "person" : "barter", `message ${i}`, new Date(2026, 0, 1, 0, i));
  const recent = await recentTexts(db, phone, 3);
  assert.deepEqual(recent.map((entry) => entry.text), ["message 2", "message 3", "message 4"]);
  assert.deepEqual(recent.map((entry) => entry.role), ["person", "barter", "person"]);
});

test("recentTexts breaks a createdAt tie by insertion order", async () => {
  const phone = "+12025550708";
  const now = new Date(2026, 0, 5, 9, 0);
  await logText(db, phone, "person", "first", now);
  await logText(db, phone, "barter", "second", now);
  assert.deepEqual((await recentTexts(db, phone, 10)).map((entry) => entry.text), ["first", "second"]);
});

test("countTextsFrom counts only that phone's person texts at or after the given time", async () => {
  const phone = "+12025550702", other = "+12025550703";
  const since = new Date(2026, 0, 2);
  await logText(db, phone, "person", "before", new Date(2026, 0, 1));
  await logText(db, phone, "person", "at the boundary", since);
  await logText(db, phone, "barter", "assistant reply", new Date(2026, 0, 3));
  await logText(db, other, "person", "someone else's text", new Date(2026, 0, 3));
  assert.equal(await countTextsFrom(db, phone, since), 1);
});

test("logText cuts long text to 2000 characters", async () => {
  const phone = "+12025550704";
  await logText(db, phone, "person", "x".repeat(2500));
  const [entry] = await recentTexts(db, phone, 1);
  assert.equal(entry.text.length, 2000);
});

test("loggingMessenger logs the text as barter after a successful send", async () => {
  const phone = "+12025550705";
  await loggingMessenger(db, messenger()).send(phone, "barter: hi");
  const [entry] = await recentTexts(db, phone, 1);
  assert.equal(entry.role, "barter");
  assert.equal(entry.text, "barter: hi");
});

test("loggingMessenger logs nothing and rethrows when the send fails", async () => {
  const phone = "+12025550706";
  await assert.rejects(loggingMessenger(db, messenger(phone)).send(phone, "barter: hi"), /Photon is down/);
  assert.deepEqual(await recentTexts(db, phone, 10), []);
});

test("loggingMessenger still sends successfully when logging fails", async () => {
  const phone = "+12025550707";
  const inner = messenger();
  const failingDb = { collection: () => ({ insertOne: async () => { throw new Error("insert failed"); } }) } as unknown as Db;
  await loggingMessenger(failingDb, inner).send(phone, "barter: hi");
  assert.deepEqual(inner.sent, [{ phone, text: "barter: hi" }]);
});

test("the TTL and lookup indexes are created", async () => {
  const indexes = await db.collection("textMessage").indexes();
  const ttl = indexes.find((index) => index.key.createdAt === 1);
  assert.equal(ttl?.expireAfterSeconds, 1209600);
  const lookup = indexes.find((index) => index.key.phoneNumber === 1 && index.key.createdAt === -1);
  assert.ok(lookup, "expected a {phoneNumber:1, createdAt:-1} index");
});
