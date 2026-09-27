import { type ClientSession, type Db, type ObjectId } from "mongodb";
import { exchangeCollections } from "./exchange-schema";

/** Call inside a transaction so concurrent submissions and repairs serialize per user. */
export async function rebuildUserRatings(db: Db, userId: ObjectId, session: ClientSession) {
  // Acquire the user write lock before reading reviews. Also tolerate null legacy counts.
  const result = await db.collection("user").updateOne(
    { _id: userId }, { $set: { rating: 0, numberOfReviews: 0, reviews: [] } }, { session },
  );
  if (!result.matchedCount) return false;
  const received = await exchangeCollections(db).reviews.find({ subjectUserId: userId }, { session })
    .sort({ createdAt: 1, _id: 1 }).toArray();
  await db.collection("user").updateOne({ _id: userId }, { $set: {
    rating: received.length ? received.reduce((sum, review) => sum + review.rating, 0) / received.length : 0,
    numberOfReviews: received.length,
    reviews: received.map(review => review._id.toHexString()),
  } }, { session });
  return true;
}

export async function rebuildAllUserRatings(db: Db) {
  let updated = 0;
  for await (const user of db.collection("user").find({}, { projection: { _id: 1 } })) {
    const found = await db.client.withSession(session => session.withTransaction(
      () => rebuildUserRatings(db, user._id, session),
    ));
    if (found) updated++;
  }
  return updated;
}
