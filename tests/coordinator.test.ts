import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ObjectId, type Db } from "mongodb";
import { InputError } from "../lib/auth-validation";
import { ASSISTANT_ERROR_TEXT, RATE_LIMITED_TEXT } from "../lib/booking-texts";
import type { ActiveBooking } from "../lib/coordination";
import { coordinate, type CoordinatorDeps, type Sender } from "../lib/coordinator";
import type { Booking, BookingProposal } from "../lib/exchange-schema";
import { LlmError, type AssistantMessage, type ChatMessage, type Llm, type ToolCall, type ToolDefinition } from "../lib/llm";
import type { LoggedText } from "../lib/text-log";

// Fake booking rules, text log, model and messenger: no database or network.
const db = {} as Db;
const now = new Date("2026-09-27T18:00:00Z"); // Sunday, 2 PM in New York
const saturday = { day: 6, start: 600, end: 840 };
const saturdayAt11 = new Date("2026-10-03T15:00:00Z");
const barry: Sender = { _id: new ObjectId(), firstName: "Barry", phoneNumber: "+12025550601" };
const emily = { id: new ObjectId(), firstName: "Emily", phoneNumber: "+12025550602" };
const sam = { id: new ObjectId(), firstName: "Sam", phoneNumber: "+12025550603" };
const guitarId = new ObjectId("64b7f0c2a1b2c3d4e5f67f3a"), tutoringId = new ObjectId("64b7f0c2a1b2c3d4e5f619c2");

// Barry booked Emily's in-person guitar lessons.
function guitar(fields: Partial<Booking> = {}, other: ActiveBooking["other"] = emily): ActiveBooking {
  const booking: Booking = {
    _id: guitarId, serviceId: new ObjectId(), providerId: other.id, requesterId: barry._id,
    serviceSnapshot: { title: "Guitar Lessons", description: "Beginner lessons on acoustic guitar.", pricingType: "hourly", creditRate: 200, deliveryMode: "in_person", availability: [{ day: 3, start: 1020, end: 1200 }, saturday] },
    durationMinutes: 90, totalCredits: 300, preferredWindow: saturday, note: "Total beginner", status: "accepted",
    createdAt: new Date("2026-09-26T12:00:00Z"), updatedAt: new Date("2026-09-26T12:00:00Z"), ...fields,
  };
  return { booking, role: "requester", other, code: "7F3A" };
}
// Barry tutors Sam remotely, at an agreed time.
function tutoring(): ActiveBooking {
  const booking: Booking = {
    _id: tutoringId, serviceId: new ObjectId(), providerId: barry._id, requesterId: sam.id,
    serviceSnapshot: { title: "Calculus Tutoring", description: "Homework help.", pricingType: "fixed", creditRate: 100, deliveryMode: "remote", availability: [{ day: 1, start: 1020, end: 1200 }, { day: 3, start: 1020, end: 1200 }] },
    totalCredits: 100, scheduledAt: new Date("2026-10-01T22:00:00Z"), place: "on Zoom", status: "accepted",
    createdAt: new Date("2026-09-25T12:00:00Z"), updatedAt: new Date("2026-09-25T12:00:00Z"),
  };
  return { booking, role: "provider", other: sam, code: "19C2" };
}

type Options = { bookings?: ActiveBooking[]; thread?: LoggedText[]; count?: number; propose?: CoordinatorDeps["propose"]; confirm?: CoordinatorDeps["confirm"] };

// Booking rules and a text log that record their calls.
function fakes({ bookings = [guitar()], thread = [], count = 1, propose, confirm }: Options = {}) {
  const calls: { name: keyof CoordinatorDeps; args: unknown[] }[] = [];
  const deps: CoordinatorDeps = {
    async activeBookings(...args) { calls.push({ name: "activeBookings", args }); return bookings; },
    async propose(...args) {
      calls.push({ name: "propose", args });
      const [, actorId, , input, at] = args;
      return propose ? propose(...args) : { startsAt: input.startsAt, ...(input.place?.trim() ? { place: input.place.trim() } : {}), byUserId: actorId, createdAt: at ?? now };
    },
    async confirm(...args) { calls.push({ name: "confirm", args }); return confirm ? confirm(...args) : { scheduledAt: saturdayAt11, place: "Butler Library" }; },
    async recentTexts(...args) { calls.push({ name: "recentTexts", args }); return thread; },
    async countTextsFrom(...args) { calls.push({ name: "countTextsFrom", args }); return count; },
  };
  return { deps, called: (name: keyof CoordinatorDeps) => calls.filter((call) => call.name === name).map((call) => call.args) };
}

// A model that returns the scripted replies in order, repeating the last, and records what it was sent.
function model(...replies: (AssistantMessage | Error)[]) {
  const calls: { messages: ChatMessage[]; tools: ToolDefinition[] }[] = [];
  const llm: Llm = {
    async chat(messages, tools) {
      calls.push({ messages: [...messages], tools });
      const reply = replies[Math.min(calls.length, replies.length) - 1];
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { llm, calls };
}
const say = (content: string): AssistantMessage => ({ role: "assistant", content });
const use = (...calls: ToolCall[]): AssistantMessage => ({ role: "assistant", content: null, tool_calls: calls });
const call = (id: string, name: string, args: unknown): ToolCall => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
// The tool results the model got back, in order.
const results = (messages: ChatMessage[]) => messages.flatMap((message) => message.role === "tool" ? [[message.tool_call_id, message.content]] : []);

function messenger(failFor?: string) {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { if (failFor && (failFor === "everyone" || phone === failFor)) throw new Error("Photon is down"); sent.push({ phone, text }); } };
}
// Silences the error log and records it.
const errorLog = (t: TestContext) => t.mock.method(console, "error", () => {});

test("a plain answer goes back to the sender", async () => {
  const { deps, called } = fakes();
  const { llm, calls } = model(say("Your lesson isn't scheduled yet. Want to suggest a time?"));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "When is my lesson?", now, deps);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: "barter: Your lesson isn't scheduled yet. Want to suggest a time?" }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tools.map((tool) => tool.function.name), ["propose_time", "confirm_time", "send_note"]);
  assert.deepEqual(called("activeBookings"), [[db, barry._id]]);
});

test("a proposal is saved, relayed in fixed wording and reported to the model", async () => {
  const { deps, called } = fakes();
  const { llm, calls } = model(use(call("call_1", "propose_time", { code: "7F3A", starts_at: "2026-10-03T11:00", place: " Butler Library " })), say("Sent to Emily. I'll text you when Emily answers."));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Sat 11 AM at Butler Library", now, deps);
  assert.deepEqual(called("propose"), [[db, barry._id, guitarId, { startsAt: saturdayAt11, place: " Butler Library " }, now]]);
  const relay = "barter: Barry suggests Sat, Oct 3 at 11 AM at Butler Library for Guitar Lessons. Reply OK to confirm, or suggest another time.";
  assert.deepEqual(texts.sent, [{ phone: emily.phoneNumber, text: relay }, { phone: barry.phoneNumber, text: "barter: Sent to Emily. I'll text you when Emily answers." }]);
  assert.deepEqual(results(calls[1].messages), [["call_1", `Texted Emily: ${relay}`]]);
});

test("confirming uses the proposal Barry saw and texts both people", async () => {
  const proposal: BookingProposal = { startsAt: saturdayAt11, place: "Butler Library", byUserId: emily.id, createdAt: new Date("2026-09-27T17:00:00Z") };
  const { deps, called } = fakes({ bookings: [guitar({ proposal })] });
  const { llm, calls } = model(use(call("call_ok", "confirm_time", { code: "7f3a" })), say(""));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "OK", now, deps);
  assert.deepEqual(called("confirm"), [[db, barry._id, guitarId, proposal.createdAt, now]]);
  const toBarry = "barter: You're set: Guitar Lessons with Emily on Sat, Oct 3 at 11 AM at Butler Library.";
  // An empty final reply adds no text.
  assert.deepEqual(texts.sent, [
    { phone: emily.phoneNumber, text: "barter: You're set: Guitar Lessons with Barry on Sat, Oct 3 at 11 AM at Butler Library." },
    { phone: barry.phoneNumber, text: toBarry },
  ]);
  assert.deepEqual(results(calls[1].messages), [["call_ok", `Confirmed, and both people were texted. Barry got: ${toBarry}`]]);
});

test("a note is passed along in fixed wording", async () => {
  const { deps } = fakes();
  const { llm, calls } = model(use(call("call_note", "send_note", { code: "7F3A", note: "  I'll bring my own\nguitar. " })), say("Sent to Emily."));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Tell Emily I'll bring my own guitar", now, deps);
  const relay = 'barter: Barry says about Guitar Lessons: "I\'ll bring my own guitar."';
  assert.deepEqual(texts.sent, [{ phone: emily.phoneNumber, text: relay }, { phone: barry.phoneNumber, text: "barter: Sent to Emily." }]);
  assert.deepEqual(results(calls[1].messages), [["call_note", `Texted Emily: ${relay}`]]);
});

test("bad tool calls get error results and change nothing", async () => {
  const { deps, called } = fakes({ bookings: [guitar(), tutoring()] });
  const { llm, calls } = model(use(
    call("c1", "propose_time", { code: "ZZZZ", starts_at: "2026-10-03T11:00" }),
    call("c2", "propose_time", "{not json"),
    call("c3", "propose_time", '["7F3A"]'),
    call("c4", "propose_time", { code: "7F3A", starts_at: "Saturday at 11" }),
    // Skipped when clocks spring forward.
    call("c5", "propose_time", { code: "7F3A", starts_at: "2027-03-14T02:30" }),
    call("c6", "propose_time", { code: "7F3A", starts_at: "2026-10-03T11:00", place: 42 }),
    call("c7", "send_note", { code: "7F3A", note: " \n " }),
    call("c8", "send_note", { code: "7F3A", note: "x".repeat(301) }),
    call("c9", "confirm_time", { code: "7F3A" }),
    call("c10", "cancel_booking", { code: "7F3A" }),
  ), say("Which booking do you mean?"));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Cancel it", now, deps);
  const badTime = 'Error: starts_at must be a New York time like "2026-10-03T11:00".';
  assert.deepEqual(results(calls[1].messages), [
    ["c1", "Error: No booking has that code. Use one of: 7F3A, 19C2."],
    ["c2", "Error: The arguments must be a JSON object."],
    ["c3", "Error: The arguments must be a JSON object."],
    ["c4", badTime],
    ["c5", badTime],
    ["c6", "Error: The place must be text."],
    ["c7", "Error: A note must be 1 to 300 characters."],
    ["c8", "Error: A note must be 1 to 300 characters."],
    ["c9", "Error: There's no suggested time to confirm."],
    ["c10", "Error: Unknown tool."],
  ]);
  assert.deepEqual([...called("propose"), ...called("confirm")], []);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: "barter: Which booking do you mean?" }]);
});

test("nothing is saved or sent when the other person can't be texted", async () => {
  const { deps, called } = fakes({ bookings: [guitar({}, { id: emily.id, firstName: "Emily" })] });
  const { llm, calls } = model(use(call("c1", "propose_time", { code: "7F3A", starts_at: "2026-10-03T11:00" })), say("Emily can't get texts right now."));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Sat 11 AM", now, deps);
  assert.deepEqual(results(calls[1].messages), [["c1", "Error: Emily can't be reached by text, so nothing was sent."]]);
  assert.deepEqual(called("propose"), []);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: "barter: Emily can't get texts right now." }]);
});

test("a rule the booking breaks goes back to the model, which can explain it", async () => {
  const { deps } = fakes({ propose: async () => { throw new InputError("Pick a time at least 30 minutes from now."); } });
  const { llm, calls } = model(use(call("c1", "propose_time", { code: "7F3A", starts_at: "2026-09-27T14:10" })), say("That's too soon. How about later today?"));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "In 10 minutes?", now, deps);
  assert.deepEqual(results(calls[1].messages), [["c1", "Error: Pick a time at least 30 minutes from now."]]);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: "barter: That's too soon. How about later today?" }]);
});

test("confirming Barry's own suggestion is refused by the rules, and the model is told", async () => {
  const proposal: BookingProposal = { startsAt: saturdayAt11, byUserId: barry._id, createdAt: now };
  const { deps, called } = fakes({ bookings: [guitar({ proposal })], confirm: async () => { throw new InputError("Only the other person can confirm this suggestion."); } });
  const { llm, calls } = model(use(call("c1", "confirm_time", { code: "7F3A" })), say("Only Emily can confirm your suggestion."));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "OK", now, deps);
  assert.ok(String(calls[0].messages[0].content).includes('"latestSuggestion":{"by":"Barry (the sender)","time":"Sat, Oct 3 at 11 AM","place":"not given","senderCanConfirm":false}'));
  assert.deepEqual(called("confirm"), [[db, barry._id, guitarId, now, now]]);
  assert.deepEqual(results(calls[1].messages), [["c1", "Error: Only the other person can confirm this suggestion."]]);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: "barter: Only Emily can confirm your suggestion." }]);
});

test("an all-digit code sent as a number still matches", async () => {
  const { deps } = fakes({ bookings: [{ ...guitar(), code: "2468" }] });
  const { llm } = model(use(call("n", "send_note", { code: 2468, note: "Hi" })), say("Sent."));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Tell Emily hi", now, deps);
  assert.deepEqual(texts.sent, [{ phone: emily.phoneNumber, text: 'barter: Barry says about Guitar Lessons: "Hi"' }, { phone: barry.phoneNumber, text: "barter: Sent." }]);
});

test("several tool calls in one reply all run, in order", async () => {
  const { deps } = fakes({ bookings: [guitar(), tutoring()] });
  const { llm, calls } = model(use(
    call("a", "propose_time", { code: "7F3A", starts_at: "2026-10-03T11:00" }),
    call("b", "send_note", { code: "19c2", note: "Bring last week's homework." }),
  ), say("Sent to Emily and Sam."));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Sat 11 AM for guitar, and tell Sam to bring the homework", now, deps);
  assert.deepEqual(texts.sent, [
    { phone: emily.phoneNumber, text: "barter: Barry suggests Sat, Oct 3 at 11 AM for Guitar Lessons. Reply OK to confirm, or suggest another time." },
    { phone: sam.phoneNumber, text: 'barter: Barry says about Calculus Tutoring: "Bring last week\'s homework."' },
    { phone: barry.phoneNumber, text: "barter: Sent to Emily and Sam." },
  ]);
  assert.deepEqual(calls[1].messages.slice(-3).map((message) => message.role), ["assistant", "tool", "tool"]);
  assert.deepEqual(results(calls[1].messages).map(([id]) => id), ["a", "b"]);
});

test("the model's messages go back unchanged, provider fields included", async () => {
  const signed = { id: "call_signed", type: "function" as const, function: { name: "send_note", arguments: '{"code":"7F3A","note":"See you there"}' }, extra_content: { google: { thought_signature: "c2lnbmF0dXJl" } } };
  const first: AssistantMessage = { role: "assistant", content: null, tool_calls: [signed], reasoning_content: "Barry wants a note sent." };
  const original = structuredClone(first);
  const { deps } = fakes();
  const { llm, calls } = model(first, say("Sent to Emily."));
  await coordinate(db, messenger(), llm, barry, "Tell Emily see you there", now, deps);
  assert.equal(calls[1].messages.at(-2), first);
  assert.deepEqual(first, original);
  assert.deepEqual(calls[1].messages.at(-1), { role: "tool", tool_call_id: "call_signed", content: 'Texted Emily: barter: Barry says about Guitar Lessons: "See you there"' });
});

test("running out of steps ends with an apology, and the last step's tools don't run", async (t) => {
  const log = errorLog(t);
  const { deps } = fakes();
  const { llm, calls } = model(use(call("c", "send_note", { code: "7F3A", note: "Ping" })));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Keep pinging Emily", now, deps);
  assert.equal(calls.length, 4);
  const ping = { phone: emily.phoneNumber, text: 'barter: Barry says about Guitar Lessons: "Ping"' };
  assert.deepEqual(texts.sent, [ping, ping, ping, { phone: barry.phoneNumber, text: ASSISTANT_ERROR_TEXT }]);
  assert.deepEqual(log.mock.calls.map((entry) => entry.arguments[0]), ["[auth] Assistant"]);
});

test("a model error ends with an apology and a log line without phone numbers", async (t) => {
  const log = errorLog(t);
  const { deps } = fakes();
  const { llm } = model(new LlmError(`Gemini answered 500 for ${barry.phoneNumber}`));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Sat 11 AM?", now, deps);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: ASSISTANT_ERROR_TEXT }]);
  assert.deepEqual(log.mock.calls.map((entry) => entry.arguments[0]), ["[auth] Assistant"]);
  assert.ok(!JSON.stringify(log.mock.calls.map((entry) => entry.arguments)).includes(barry.phoneNumber));
});

test("an unexpected error in a tool stops the run with an apology", async (t) => {
  errorLog(t);
  const { deps } = fakes({ propose: async () => { throw new Error("connection reset"); } });
  const { llm, calls } = model(use(call("c1", "propose_time", { code: "7F3A", starts_at: "2026-10-03T11:00" })), say("Sent!"));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Sat 11 AM", now, deps);
  assert.equal(calls.length, 1);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: ASSISTANT_ERROR_TEXT }]);
});

test("a failed relay after confirming ends with an apology, and the confirmation stays", async (t) => {
  errorLog(t);
  const proposal: BookingProposal = { startsAt: saturdayAt11, place: "Butler Library", byUserId: emily.id, createdAt: now };
  const { deps, called } = fakes({ bookings: [guitar({ proposal })] });
  const { llm, calls } = model(use(call("c1", "confirm_time", { code: "7F3A" })), say("You're set!"));
  const texts = messenger(emily.phoneNumber);
  await coordinate(db, texts, llm, barry, "OK", now, deps);
  assert.equal(called("confirm").length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: ASSISTANT_ERROR_TEXT }]);
});

test("coordinate never throws, even when the apology can't be sent", async (t) => {
  const log = errorLog(t);
  const { deps } = fakes();
  await coordinate(db, messenger(), model(say("Hi")).llm, barry, "Hi", now, { ...deps, activeBookings: async () => { throw new Error("database down"); } });
  await coordinate(db, messenger("everyone"), model(say("Hi")).llm, barry, "Hi", now, deps);
  assert.deepEqual(log.mock.calls.map((entry) => entry.arguments[0]), ["[auth] Assistant", "[auth] Assistant", "[auth] Assistant apology"]);
});

test("without a model, the text reaches the newest booking's other person as a note", async () => {
  // Newest first, as activeBookings returns them.
  const { deps } = fakes({ bookings: [guitar(), tutoring()] });
  const texts = messenger();
  await coordinate(db, texts, null, barry, "Running 5 minutes late\nsorry", now, deps);
  assert.deepEqual(texts.sent, [
    { phone: emily.phoneNumber, text: 'barter: Barry says about Guitar Lessons: "Running 5 minutes late sorry"' },
    { phone: barry.phoneNumber, text: "barter: Sent to Emily." },
  ]);
});

test("without a model, nothing goes to someone who can't be texted, and the sender gets the apology", async (t) => {
  const log = errorLog(t);
  const { deps } = fakes({ bookings: [guitar({}, { id: emily.id, firstName: "Emily" })] });
  const texts = messenger();
  await coordinate(db, texts, null, barry, "Running late", now, deps);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: ASSISTANT_ERROR_TEXT }]);
  assert.deepEqual(log.mock.calls.map((entry) => entry.arguments[0]), ["[auth] Assistant"]);
});

test("past 30 texts in an hour, the model isn't called", async () => {
  const { deps, called } = fakes({ count: 31 });
  const { llm, calls } = model(say("Hi"));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Hello?", now, deps);
  assert.deepEqual(texts.sent, [{ phone: barry.phoneNumber, text: RATE_LIMITED_TEXT }]);
  assert.equal(calls.length, 0);
  assert.deepEqual(called("countTextsFrom"), [[db, barry.phoneNumber, new Date("2026-09-27T17:00:00Z")]]);
  assert.deepEqual(called("activeBookings"), []);
  await coordinate(db, texts, llm, barry, "Hello?", now, fakes({ count: 30 }).deps);
  assert.equal(calls.length, 1);
});

test("without an active booking, nothing happens", async () => {
  const { deps } = fakes({ bookings: [] });
  const { llm, calls } = model(say("Hi"));
  const texts = messenger();
  await coordinate(db, texts, llm, barry, "Hi", now, deps);
  await coordinate(db, texts, null, barry, "Hi", now, deps);
  assert.equal(calls.length, 0);
  assert.deepEqual(texts.sent, []);
});

test("the model sees codes, titles, availability and names, but no phone numbers or IDs", async () => {
  const proposal: BookingProposal = { startsAt: saturdayAt11, place: "Butler Library", byUserId: emily.id, createdAt: now };
  const bookings = [guitar({ proposal, serviceSnapshot: { ...guitar().booking.serviceSnapshot, description: `${"d".repeat(300)}CUT` } }), tutoring()];
  const { deps } = fakes({ bookings });
  const { llm, calls } = model(say("Which booking?"));
  await coordinate(db, messenger(), llm, barry, "When is it?", now, deps);
  assert.equal(calls[0].messages[0].role, "system");
  const system = String(calls[0].messages[0].content);
  for (const expected of [
    "Sunday 2026-09-27T14:00", "Sat 2026-10-03", '"Barry"', "7F3A", "19C2", "Guitar Lessons", "Calculus Tutoring", "Emily", "Sam",
    "Wed 5–8 PM · Sat 10 AM–2 PM", "Mon, Wed 5–8 PM", "Sat 10 AM–2 PM", "in person", "remote", "Total beginner",
    "2 coins / hour, 90 minutes, 3 coins total", "1 coin / service, 1 coin total",
    "Sat, Oct 3 at 11 AM", "Butler Library", "Thu, Oct 1 at 6 PM", "on Zoom", "d".repeat(300),
  ]) assert.ok(system.includes(expected), expected);
  const everything = JSON.stringify(calls[0]);
  const ids = [barry._id, emily.id, sam.id, ...bookings.flatMap(({ booking }) => [booking._id, booking.serviceId])].map((id) => id.toHexString());
  for (const hidden of ["CUT", barry.phoneNumber, emily.phoneNumber, sam.phoneNumber, ...ids]) assert.ok(!everything.includes(hidden), hidden);
});

test("the thread becomes the conversation, ending with the text once", async () => {
  const at = new Date("2026-09-27T17:00:00Z");
  const thread: LoggedText[] = [
    { role: "barter", text: "barter: Emily accepted your Guitar Lessons request! We'll text you when Emily suggests a time and place.", createdAt: at },
    { role: "person", text: "Great, thanks", createdAt: at },
    { role: "barter", text: "barter: Emily suggests Sat, Oct 3 at 11 AM at Butler Library for Guitar Lessons. Reply OK to confirm, or suggest another time.", createdAt: at },
    { role: "person", text: "OK", createdAt: at },
  ];
  const expected = [
    { role: "assistant", content: thread[0].text },
    { role: "user", content: "Great, thanks" },
    { role: "assistant", content: thread[2].text },
    { role: "user", content: "OK" },
  ];
  const logged = fakes({ thread });
  const { llm, calls } = model(say("Done."));
  await coordinate(db, messenger(), llm, barry, "OK", now, logged.deps);
  assert.deepEqual(logged.called("recentTexts"), [[db, barry.phoneNumber, 20]]);
  assert.deepEqual(calls[0].messages.slice(1), expected);
  // When the router couldn't log the text, it's added.
  await coordinate(db, messenger(), llm, barry, "OK", now, fakes({ thread: thread.slice(0, 3) }).deps);
  assert.deepEqual(calls[1].messages.slice(1), expected);
});
