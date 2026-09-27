// Registers people with Photon so it can text them. Server-only: it uses the project secret.
export const PHOTON_API = "https://spectrum.photon.codes";

export type PhotonPerson = { phoneNumber: string; firstName: string; lastName: string };
export type RegisterPhoton = (person: PhotonPerson) => Promise<{ id: string; assignedPhoneNumber: string }>;

export function photonConfigured() {
  return Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET);
}

/** Photon's REST API takes Basic auth with the project ID and secret. */
export function photonAuthorization() {
  const projectId = process.env.SPECTRUM_PROJECT_ID, secret = process.env.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !secret) throw new Error("Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET.");
  return { projectId, header: `Basic ${Buffer.from(`${projectId}:${secret}`).toString("base64")}` };
}

// Photon returns the existing user when a phone number is registered again, so this is safe to repeat.
export const registerPhotonUser: RegisterPhoton = async ({ phoneNumber, firstName, lastName }) => {
  const { projectId, header } = photonAuthorization();
  const response = await fetch(`${PHOTON_API}/projects/${encodeURIComponent(projectId)}/users/`, {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify({ type: "shared", phoneNumber, firstName, lastName }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  const user = payload?.data;
  if (!response.ok || typeof user?.id !== "string" || typeof user?.assignedPhoneNumber !== "string") throw new Error(`Photon user registration failed with status ${response.status}.`);
  return { id: user.id, assignedPhoneNumber: user.assignedPhoneNumber };
};
