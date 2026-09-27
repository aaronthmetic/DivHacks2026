import type { ObjectId } from "mongodb";
import { formatAvailability } from "./availability";
import type { AvailabilityWindow } from "./exchange-schema";
import { coinsLabel } from "./listing-data";

// Every text barter sends about requests. People are named, never referred to with pronouns.

// Collapses newlines and control characters so a user's note or title can't forge extra lines in an SMS.
const oneLine = (value: string) => value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();

export const WELCOME_TEXT = "barter: You're all set. We'll text you here about requests.";
export const NO_REQUESTS_TEXT = "barter: You don't have any requests waiting for an answer.";
export const ALREADY_ANSWERED_TEXT = "barter: That request was already answered or cancelled.";
export const HELP_TEXT = "barter: Reply YES or NO to answer a request. We'll text you when there's news.";

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

export function acceptedTexts({ title, requesterFirstName, providerFirstName }: Answer) {
  return {
    provider: `barter: You accepted ${oneLine(requesterFirstName)}'s ${oneLine(title)} request. We'll help you both pick a time and place next.`,
    requester: `barter: ${oneLine(providerFirstName)} accepted your ${oneLine(title)} request! We'll help you both pick a time and place next.`,
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
