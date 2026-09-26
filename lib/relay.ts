import { isE164 } from "./phone";

// Pairing for the Photon relay (scripts/relay.ts): two people text their
// Photon numbers and each message goes to the other person. No Photon calls
// here, so the "who gets what" decision can change on its own.

export type Person = { phone: string; name: string };
export type Pair = [Person, Person];

export function loadPair(env: NodeJS.ProcessEnv = process.env): Pair {
  const [a, b] = (["A", "B"] as const).map((key) => {
    const phone = env[`RELAY_${key}_PHONE`]?.trim() ?? "";
    const name = env[`RELAY_${key}_NAME`]?.trim() ?? "";
    if (!isE164(phone) || !name) {
      throw new Error(
        `Set RELAY_${key}_PHONE (like +15551234567) and RELAY_${key}_NAME in .env.local.`,
      );
    }
    return { phone, name };
  });
  if (a.phone === b.phone) {
    throw new Error("RELAY_A_PHONE and RELAY_B_PHONE must be different numbers.");
  }
  return [a, b];
}

/** The sender and who their message goes to, or null if the sender isn't in the pair. */
export function routeMessage(pair: Pair, senderId: string) {
  const [a, b] = pair;
  if (senderId === a.phone) return { from: a, to: b };
  if (senderId === b.phone) return { from: b, to: a };
  return null;
}
