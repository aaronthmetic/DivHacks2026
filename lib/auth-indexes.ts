import type { Db } from "mongodb";

export async function ensureAuthIndexes(db: Db) {
  await Promise.all([
    db.collection("user").createIndex({ email: 1 }, { unique: true, name: "unique_email" }),
    db.collection("user").createIndex({ phoneNumber: 1 }, { unique: true, partialFilterExpression: { phoneNumber: { $type: "string" } }, name: "unique_phone" }),
    db.collection("account").createIndex({ providerId: 1, accountId: 1 }, { unique: true }),
    db.collection("account").createIndex({ userId: 1 }),
    db.collection("session").createIndex({ token: 1 }, { unique: true }),
    db.collection("session").createIndex({ userId: 1 }),
    db.collection("session").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("verification").createIndex({ identifier: 1 }),
    db.collection("verification").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("rateLimit").createIndex({ key: 1 }, { unique: true }),
    db.collection("profileRateLimit").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}
