// No "server-only" import: scripts/relay.ts runs this outside Next.js. The
// secret isn't a NEXT_PUBLIC_ variable, so it never reaches the browser.
import { Spectrum, UnsupportedError } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { isE164 } from "./phone";

export type PhotonErrorCode =
  | "invalid_phone"
  | "not_configured"
  | "groups_unsupported";

export class PhotonError extends Error {
  constructor(
    readonly code: PhotonErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PhotonError";
  }
}

async function createSpectrum() {
  const projectId = process.env.SPECTRUM_PROJECT_ID;
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    throw new PhotonError(
      "not_configured",
      "Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in .env.local (Photon dashboard → your project → Settings).",
    );
  }
  return Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
}

type SpectrumApp = Awaited<ReturnType<typeof createSpectrum>>;

// One client per server process. Kept on globalThis so dev hot reloads reuse
// it instead of opening a new connection on every edit.
const cache = globalThis as unknown as { photonSpectrum?: Promise<SpectrumApp> };

export function getSpectrum(): Promise<SpectrumApp> {
  cache.photonSpectrum ??= createSpectrum().catch((error: unknown) => {
    cache.photonSpectrum = undefined; // let the next call retry
    throw error;
  });
  return cache.photonSpectrum;
}

function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (!isE164(trimmed)) {
    throw new PhotonError(
      "invalid_phone",
      "Phone numbers must be in E.164 format, like +15551234567.",
    );
  }
  return trimmed;
}

/** Sends a 1:1 iMessage. Works on every Photon plan. */
export async function sendDirectMessage(phone: string, text: string) {
  const to = toE164(phone);
  const im = imessage(await getSpectrum());
  const space = await im.space.create(await im.user(to));
  await space.send(text);
  return { spaceId: space.id };
}

/**
 * Creates an iMessage group with two people (plus your Photon line) and posts
 * `intro` to it. Keep the returned `spaceId` to message the group later with
 * `imessage(app).space.get(spaceId)`.
 *
 * Needs a dedicated Photon line (Business plan); shared-number plans like
 * Free and Pro reject group creation.
 */
export async function createGroupChat(phones: [string, string], intro: string) {
  const [a, b] = phones.map(toE164);
  if (a === b) {
    throw new PhotonError(
      "invalid_phone",
      "A group chat needs two different phone numbers.",
    );
  }
  const im = imessage(await getSpectrum());
  const users = await Promise.all([im.user(a), im.user(b)]);
  const group = await im.space.create(users).catch((error: unknown) => {
    if (error instanceof UnsupportedError) {
      throw new PhotonError(
        "groups_unsupported",
        `Photon won't create this group (${error.message}). Group chats need a dedicated Photon line (Business plan); shared-number plans like Free and Pro can only send DMs.`,
        { cause: error },
      );
    }
    throw error;
  });
  await group.send(intro);
  return { spaceId: group.id };
}
