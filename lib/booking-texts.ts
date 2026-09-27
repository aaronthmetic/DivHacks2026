import type { ObjectId } from "mongodb";
import { SHORT_DAY_NAMES, formatAvailability, formatClock } from "./availability";
import type { AvailabilityWindow, ServiceSnapshot } from "./exchange-schema";
import { coinsLabel } from "./listing-data";

// Every text barter sends about requests and bookings. People are named, never referred to with pronouns.

// Collapses newlines and control characters so a user's note or title can't forge extra lines in an SMS.
const oneLine = (value: string) => value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();

export const WELCOME_TEXT = "barter: You're all set. We'll text you here about requests.";
export const NO_REQUESTS_TEXT = "barter: You don't have any requests waiting for an answer.";
export const ALREADY_ANSWERED_TEXT = "barter: That request was already answered or cancelled.";
export const HELP_TEXT = "barter: Reply YES or NO to answer a request. We'll text you when there's news.";
export const ASSISTANT_ERROR_TEXT = "barter: Sorry, something went wrong on our side. Please try again in a minute.";
export const RATE_LIMITED_TEXT = "barter: That's a lot of texts. Please wait a bit and try again.";

/** The code people reply with: the end of the booking ID, uppercase. */
export function bookingCode(id: ObjectId | string, length = 4) {
  return String(id).slice(-length).toUpperCase();
}

export type RequestDetails = {
  requesterName: string; requesterFirstName: string; title: string;
  pricingType: "fixed" | "hourly"; totalCredits: number; hours?: number;
  window?: AvailabilityWindow; offers: string[]; note?: string; code: string;
};

export function requestText(details: RequestDetails) {
  const { hours = 1, offers } = details;
  const amount = details.pricingType === "hourly" ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "1 service";
  const offered = offers.length > 3 ? `${offers.slice(0, 3).map(oneLine).join(", ")} +${offers.length - 3} more` : offers.map(oneLine).join(", ");
  return [
    `barter: ${oneLine(details.requesterName)} wants your ${oneLine(details.title)}`,
    `${amount} · ${coinsLabel(details.totalCredits)} (already held)`,
    `Prefers ${details.window ? formatAvailability([details.window]) : "any time"}`,
    ...(offers.length ? [`${oneLine(details.requesterFirstName)} offers: ${offered}`] : []),
    ...(details.note ? [`Note: "${oneLine(details.note)}"`] : []),
    "",
    `Reply YES or NO (request ${details.code})`,
  ].join("\n");
}

export function requestSentText({ title, providerName, providerFirstName }: { title: string; providerName: string; providerFirstName: string }) {
  return `barter: Your request for ${oneLine(title)} was sent to ${oneLine(providerName)}. We'll text you when ${oneLine(providerFirstName)} answers.`;
}

type Answer = { title: string; requesterFirstName: string; providerFirstName: string };

// The provider is asked for a time and place right away, within the requester's preferred window when there is one.
export function acceptedTexts({ title, requesterFirstName, providerFirstName, window, deliveryMode }: Answer & { window?: AvailabilityWindow; deliveryMode?: ServiceSnapshot["deliveryMode"] }) {
  const when = window ? `What time on ${formatAvailability([window])} works for you` : "What day and time work for you";
  const how = deliveryMode === "remote" ? "how will you meet" : deliveryMode === "either" ? "where or how will you meet" : "where";
  const example = `${window ? `${SHORT_DAY_NAMES[window.day]} ${formatClock(window.start)}` : "Sat 11 AM"} ${deliveryMode === "remote" ? "on Zoom" : "at Butler Library"}`;
  return {
    provider: `barter: You accepted ${oneLine(requesterFirstName)}'s ${oneLine(title)} request. ${when}, and ${how}? Reply like "${example}".`,
    requester: `barter: ${oneLine(providerFirstName)} accepted your ${oneLine(title)} request! We'll text you when ${oneLine(providerFirstName)} suggests a time and place.`,
  };
}

export function declinedTexts({ title, requesterFirstName, providerFirstName, totalCredits }: Answer & { totalCredits: number }) {
  const refund = coinsLabel(totalCredits);
  return {
    provider: `barter: You declined ${oneLine(requesterFirstName)}'s ${oneLine(title)} request.`,
    requester: `barter: ${oneLine(providerFirstName)} can't take your ${oneLine(title)} request this time. Your ${refund} ${refund === "1 coin" ? "is" : "are"} back in your balance.`,
  };
}

export function waitingListText(waiting: { title: string; requesterFirstName: string; code: string }[]) {
  const items = waiting.map((item) => `${oneLine(item.title)} from ${oneLine(item.requesterFirstName)} (${item.code})`).join(", ");
  return `barter: You have ${waiting.length} ${waiting.length === 1 ? "request" : "requests"} waiting: ${items}. Reply YES or NO with the code, like "YES ${waiting[0].code}".`;
}

// " at Butler Library", or " on Zoom" when the place already starts with a preposition.
function placePhrase(place?: string) {
  if (!place) return "";
  const clean = oneLine(place);
  return /^(at|on|in|via|over|by)\s/i.test(clean) ? ` ${clean}` : ` at ${clean}`;
}

type Proposal = { title: string; when: string; place?: string };

/** To the person who didn't propose; `when` comes from formatNewYork. */
export function proposalText({ fromFirstName, title, when, place }: Proposal & { fromFirstName: string }) {
  return `barter: ${oneLine(fromFirstName)} suggests ${when}${placePhrase(place)} for ${oneLine(title)}. Reply OK to confirm, or suggest another time.`;
}

/** To each person once a proposal is confirmed, naming the other person. */
export function confirmedText({ otherFirstName, title, when, place }: Proposal & { otherFirstName: string }) {
  return `barter: You're set: ${oneLine(title)} with ${oneLine(otherFirstName)} on ${when}${placePhrase(place)}.`;
}

export function noteText({ fromFirstName, title, note }: { fromFirstName: string; title: string; note: string }) {
  return `barter: ${oneLine(fromFirstName)} says about ${oneLine(title)}: "${oneLine(note)}"`;
}

/** Confirms a relayed note when no assistant is configured. */
export function sentText(otherFirstName: string) {
  return `barter: Sent to ${oneLine(otherFirstName)}.`;
}

export function expiredTexts({ title, requesterFirstName, providerFirstName, totalCredits }: Answer & { totalCredits: number }) {
  const refund = coinsLabel(totalCredits);
  return {
    requester: `barter: ${oneLine(providerFirstName)} didn't answer your ${oneLine(title)} request within 48 hours, so it was cancelled. Your ${refund} ${refund === "1 coin" ? "is" : "are"} back in your balance.`,
    provider: `barter: ${oneLine(requesterFirstName)}'s ${oneLine(title)} request expired after 48 hours without an answer.`,
  };
}

/** The assistant's reply as one line starting with "barter:", at most 480 characters; empty when there's nothing to send. */
export function assistantText(reply: string) {
  const clean = oneLine(reply).replace(/^barter:\s*/i, "");
  if (!clean) return "";
  const text = `barter: ${clean}`;
  return text.length > 480 ? `${text.slice(0, 479).trimEnd()}…` : text;
}
