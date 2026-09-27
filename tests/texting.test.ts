import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { registerPhotonUser, type PhotonPerson, type RegisterPhoton } from "../lib/photon-users";
import { claimInboundMessage, enableTexts, ensurePhotonUser, ensureTextingIndexes } from "../lib/texting";

let server: MongoMemoryReplSet, client: MongoClient, db: Db;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("texting");
});
after(async () => { await client?.close(); await server?.stop(); });

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}

test("registerPhotonUser posts a shared user with the project's Basic auth", async () => {
  const saved = { id: process.env.SPECTRUM_PROJECT_ID, secret: process.env.SPECTRUM_PROJECT_SECRET };
  const realFetch = globalThis.fetch;
  process.env.SPECTRUM_PROJECT_ID = "project-1";
  process.env.SPECTRUM_PROJECT_SECRET = "secret-1";
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({ succeed: true, data: { id: "photon-user-1", assignedPhoneNumber: "+15550001111" } });
  }) as typeof fetch;
  try {
    const person = { phoneNumber: "+12025550100", firstName: "Barry", lastName: "Chen" };
    assert.deepEqual(await registerPhotonUser(person), { id: "photon-user-1", assignedPhoneNumber: "+15550001111" });
    assert.equal(calls[0].url, "https://spectrum.photon.codes/projects/project-1/users/");
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Basic ${Buffer.from("project-1:secret-1").toString("base64")}`);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { type: "shared", ...person });
    globalThis.fetch = (async () => Response.json({ succeed: false }, { status: 400 })) as typeof fetch;
    await assert.rejects(registerPhotonUser(person), /status 400/);
  } finally {
    globalThis.fetch = realFetch;
    restore("SPECTRUM_PROJECT_ID", saved.id);
    restore("SPECTRUM_PROJECT_SECRET", saved.secret);
  }
});

test("ensurePhotonUser registers a complete user once and keeps the barter number", async () => {
  const id = new ObjectId();
  await db.collection("user").insertOne({ _id: id, firstName: "Barry", lastName: "Chen", phoneNumber: "+12025550111", profileCompletedAt: new Date() });
  const calls: PhotonPerson[] = [];
  const register: RegisterPhoton = async (person) => { calls.push(person); return { id: "photon-1", assignedPhoneNumber: "+15550009999" }; };
  assert.equal(await ensurePhotonUser(db, id, register), "+15550009999");
  assert.equal(await ensurePhotonUser(db, id, register), "+15550009999");
  assert.deepEqual(calls, [{ phoneNumber: "+12025550111", firstName: "Barry", lastName: "Chen" }]);
  const stored = await db.collection("user").findOne({ _id: id });
  assert.equal(stored?.photonUserId, "photon-1");
  assert.equal(stored?.photonNumber, "+15550009999");
  const incomplete = new ObjectId();
  await db.collection("user").insertOne({ _id: incomplete, firstName: "No", lastName: "Phone", profileCompletedAt: null });
  await assert.rejects(ensurePhotonUser(db, incomplete, register), /Complete your profile/);
  assert.equal(calls.length, 1);
});

test("enableTexts records only the first text from a phone", async () => {
  const id = new ObjectId();
  await db.collection("user").insertOne({ _id: id, phoneNumber: "+12025550112" });
  assert.equal(await enableTexts(db, "+12025550112"), true);
  const first = (await db.collection("user").findOne({ _id: id }))?.textsEnabledAt;
  assert.ok(first instanceof Date);
  assert.equal(await enableTexts(db, "+12025550112"), false);
  assert.deepEqual((await db.collection("user").findOne({ _id: id }))?.textsEnabledAt, first);
  assert.equal(await enableTexts(db, "+12025550199"), false);
});

test("incoming message IDs are claimed once and expire after a week", async () => {
  await ensureTextingIndexes(db);
  assert.equal(await claimInboundMessage(db, "msg-1"), true);
  assert.equal(await claimInboundMessage(db, "msg-1"), false);
  const ttl = (await db.collection("photonMessage").indexes()).find((index) => index.key.receivedAt === 1);
  assert.equal(ttl?.expireAfterSeconds, 604800);
});
