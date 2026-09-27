import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { parseInboundText, receiveWebhook } from "../lib/photon-webhook";

let server: MongoMemoryReplSet, client: MongoClient, db: Db;
const secret = "whsec-test";
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("webhook");
});
after(async () => { await client?.close(); await server?.stop(); });

// Signs a delivery the way Photon does: HMAC-SHA256 over "v0:<unix seconds>:<body>".
function signed(body: string, { key = secret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const signature = createHmac("sha256", key).update(`v0:${timestamp}:${body}`).digest("hex");
  return new Request("http://localhost:3000/api/photon/webhook", { method: "POST", headers: { "x-spectrum-signature": `v0=${signature}`, "x-spectrum-timestamp": String(timestamp), "content-type": "application/json" }, body });
}
function delivery(message: Record<string, unknown> = {}) {
  return JSON.stringify({ event: "message.received", message: { id: "msg-1", direction: "inbound", sender: { id: "+12025550700" }, space: { id: "any;-;+12025550700" }, content: { type: "text", text: "YES 7F3A" }, ...message } });
}

test("a signed inbound text is handed over once", async () => {
  const first = await receiveWebhook(signed(delivery()), db, secret);
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.inbound, { id: "msg-1", senderPhone: "+12025550700", text: "YES 7F3A" });
  const repeat = await receiveWebhook(signed(delivery()), db, secret);
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.inbound, undefined);
});

test("forged, stale or unsigned deliveries are rejected", async () => {
  assert.equal((await receiveWebhook(signed(delivery({ id: "msg-2" }), { key: "someone-else" }), db, secret)).response.status, 401);
  assert.equal((await receiveWebhook(signed(delivery({ id: "msg-3" }), { timestamp: Math.floor(Date.now() / 1000) - 600 }), db, secret)).response.status, 401);
  const unsigned = new Request("http://localhost:3000/api/photon/webhook", { method: "POST", body: delivery({ id: "msg-4" }) });
  assert.equal((await receiveWebhook(unsigned, db, secret)).response.status, 401);
});

test("other deliveries are acknowledged and ignored", async () => {
  for (const message of [{ id: "msg-5", direction: "outbound" }, { id: "msg-6", content: { type: "attachment" } }, { id: "msg-7", sender: { id: "person@icloud.com" } }]) {
    const result = await receiveWebhook(signed(delivery(message)), db, secret);
    assert.equal(result.response.status, 200, JSON.stringify(message));
    assert.equal(result.inbound, undefined, JSON.stringify(message));
  }
  assert.equal(parseInboundText("not json"), null);
  assert.equal(parseInboundText(JSON.stringify({ event: "message.received" })), null);
});
