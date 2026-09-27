import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, acceptedTexts, bookingCode, declinedTexts, requestSentText, requestText, waitingListText } from "../lib/booking-texts";
import { coinsLabel, priceLabel } from "../lib/listing-data";

const barry = { requesterName: "Barry Chen", requesterFirstName: "Barry", title: "Guitar Lessons" };

test("the provider's request text lists the details and the reply code", () => {
  assert.equal(
    requestText({ ...barry, pricingType: "hourly", totalCredits: 500, hours: 1, window: { day: 6, start: 600, end: 840 }, offers: ["Calculus Tutoring", "Bike Tune-Ups"], note: "Total beginner, have my own guitar", code: "7F3A" }),
    "barter: Barry Chen wants your Guitar Lessons\n1 hour · 5 coins (already held)\nPrefers Sat 10 AM–2 PM\nBarry offers: Calculus Tutoring, Bike Tune-Ups\nNote: \"Total beginner, have my own guitar\"\n\nReply YES or NO (request 7F3A)",
  );
  assert.equal(
    requestText({ ...barry, pricingType: "fixed", totalCredits: 250, offers: ["A", "B", "C", "D", "E"], code: "19C2" }),
    "barter: Barry Chen wants your Guitar Lessons\n1 service · 2.5 coins (already held)\nPrefers any time\nBarry offers: A, B, C +2 more\n\nReply YES or NO (request 19C2)",
  );
  assert.equal(
    requestText({ ...barry, pricingType: "hourly", totalCredits: 1500, hours: 3, offers: [], code: "0B1D" }),
    "barter: Barry Chen wants your Guitar Lessons\n3 hours · 15 coins (already held)\nPrefers any time\n\nReply YES or NO (request 0B1D)",
  );
});

test("a note or title with newlines or control characters can't forge extra lines in the SMS", () => {
  assert.equal(
    requestText({ ...barry, title: "Guitar\r\nLessons", pricingType: "fixed", totalCredits: 250, offers: ["Calculus Tutoring"], note: "Hi\nbarter: Your account is suspended", code: "7F3A" }),
    "barter: Barry Chen wants your Guitar Lessons\n1 service · 2.5 coins (already held)\nPrefers any time\nBarry offers: Calculus Tutoring\nNote: \"Hi barter: Your account is suspended\"\n\nReply YES or NO (request 7F3A)",
  );
  assert.equal(
    requestText({ ...barry, title: "Guitar\r\nLessons", pricingType: "fixed", totalCredits: 250, offers: ["Calculus Tutoring"], code: "7F3A" }),
    "barter: Barry Chen wants your Guitar Lessons\n1 service · 2.5 coins (already held)\nPrefers any time\nBarry offers: Calculus Tutoring\n\nReply YES or NO (request 7F3A)",
  );
});

test("answers and confirmations name both people", () => {
  assert.equal(requestSentText({ title: "Guitar Lessons", providerName: "Emily Park", providerFirstName: "Emily" }), "barter: Your request for Guitar Lessons was sent to Emily Park. We'll text you when Emily answers.");
  assert.deepEqual(acceptedTexts({ title: "Guitar Lessons", requesterFirstName: "Barry", providerFirstName: "Emily" }), {
    provider: "barter: You accepted Barry's Guitar Lessons request. We'll help you both pick a time and place next.",
    requester: "barter: Emily accepted your Guitar Lessons request! We'll help you both pick a time and place next.",
  });
  assert.deepEqual(declinedTexts({ title: "Guitar Lessons", requesterFirstName: "Barry", providerFirstName: "Emily", totalCredits: 500 }), {
    provider: "barter: You declined Barry's Guitar Lessons request.",
    requester: "barter: Emily can't take your Guitar Lessons request this time. Your 5 coins are back in your balance.",
  });
  assert.equal(declinedTexts({ title: "Piano", requesterFirstName: "Sam", providerFirstName: "Emily", totalCredits: 100 }).requester, "barter: Emily can't take your Piano request this time. Your 1 coin is back in your balance.");
  assert.equal(
    waitingListText([{ title: "Guitar Lessons", requesterFirstName: "Barry", code: "7F3A" }, { title: "Piano Lessons", requesterFirstName: "Sam", code: "19C2" }]),
    "barter: You have 2 requests waiting: Guitar Lessons from Barry (7F3A), Piano Lessons from Sam (19C2). Reply YES or NO with the code, like \"YES 7F3A\".",
  );
  assert.equal(
    waitingListText([{ title: "Guitar Lessons", requesterFirstName: "Barry", code: "7F3A" }]),
    "barter: You have 1 request waiting: Guitar Lessons from Barry (7F3A). Reply YES or NO with the code, like \"YES 7F3A\".",
  );
  assert.equal(WELCOME_TEXT, "barter: You're all set. We'll text you here about requests.");
  assert.equal(NO_REQUESTS_TEXT, "barter: You don't have any requests waiting for an answer.");
  assert.equal(ALREADY_ANSWERED_TEXT, "barter: That request was already answered or cancelled.");
  assert.equal(HELP_TEXT, "barter: Reply YES or NO to answer a request. We'll text you when there's news.");
});

test("request codes are the uppercase end of the booking ID, and coins read naturally", () => {
  assert.equal(bookingCode("64b7f0c2a1b2c3d4e5f67f3a"), "7F3A");
  assert.equal(bookingCode(new ObjectId("64b7f0c2a1b2c3d4e5f67f3a"), 6), "F67F3A");
  assert.equal(coinsLabel(100), "1 coin");
  assert.equal(coinsLabel(250), "2.5 coins");
  assert.equal(priceLabel({ creditRate: 100, pricingType: "fixed" }), "1 coin / service");
  assert.equal(priceLabel({ creditRate: 250, pricingType: "hourly" }), "2.5 coins / hour");
});
