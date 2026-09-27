// Registers barter's webhook with Photon and prints the signing secret, which Photon shows only once.
// Usage: npm run photon:webhook -- https://barter2026.vercel.app/api/photon/webhook
import { PHOTON_API, photonAuthorization } from "../lib/photon-users";

async function main() {
  const webhookUrl = process.argv[2];
  if (!webhookUrl?.startsWith("https://")) throw new Error("Pass the webhook's https URL, like: npm run photon:webhook -- https://barter2026.vercel.app/api/photon/webhook");
  const { projectId, header } = photonAuthorization();
  const response = await fetch(`${PHOTON_API}/projects/${encodeURIComponent(projectId)}/webhooks/`, {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify({ webhookUrl, schemaVersion: "normalized-events.v1", eventTypes: ["message.received"] }),
  });
  const payload = await response.json().catch(() => null);
  const secret = payload?.data?.signingSecret;
  if (!response.ok || typeof secret !== "string") throw new Error(`Photon didn't register the webhook (status ${response.status}): ${JSON.stringify(payload?.error ?? payload)}`);
  console.log("Webhook registered. Add this line to .env.local and to Vercel's environment variables:");
  console.log(`SPECTRUM_WEBHOOK_SECRET=${secret}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
