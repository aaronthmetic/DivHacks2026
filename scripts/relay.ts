// Passes texts between the two people set in RELAY_A_* / RELAY_B_* (.env.local).
// Run `npm run relay`; add `-- --intro` to first text both people who they're
// connected with.
import { getSpectrum, sendDirectMessage } from "../lib/photon";
import { loadPair, routeMessage } from "../lib/relay";

async function main() {
  const pair = loadPair();
  const [a, b] = pair;
  const app = await getSpectrum();
  process.on("SIGINT", () => {
    void app.stop().finally(() => process.exit(0));
  });

  if (process.argv.includes("--intro")) {
    for (const [person, other] of [
      [a, b],
      [b, a],
    ]) {
      await sendDirectMessage(
        person.phone,
        `You're connected with ${other.name}. Reply here and I'll pass it along.`,
      );
    }
    console.log("Sent intros.");
  }

  console.log(`Relaying between ${a.name} and ${b.name}. Ctrl+C to stop.`);

  const seen = new Set<string>();
  for await (const [, message] of app.messages) {
    if (message.direction !== "inbound" || message.sender?.kind === "agent") continue;
    if (seen.has(message.id)) continue;
    if (seen.size > 1000) seen.clear();
    seen.add(message.id);

    const senderId = message.sender?.id ?? "";
    const route = routeMessage(pair, senderId);
    if (!route) {
      console.log(`Ignored a message from ${senderId || "an unknown sender"}.`);
      continue;
    }

    const { from, to } = route;
    const text =
      message.content.type === "text"
        ? `${from.name}: ${message.content.text}`
        : `${from.name} sent something I can't relay yet (text only for now).`;
    try {
      await sendDirectMessage(to.phone, text);
      console.log(`${from.name} → ${to.name}`);
    } catch (error) {
      console.error(
        `Couldn't relay ${from.name} → ${to.name}:`,
        error instanceof Error ? error.message : error,
      );
      await sendDirectMessage(from.phone, `Couldn't deliver that to ${to.name}.`).catch(
        () => {},
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
