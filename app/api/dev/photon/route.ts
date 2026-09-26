import {
  createGroupChat,
  PhotonError,
  type PhotonErrorCode,
  sendDirectMessage,
} from "@/lib/photon";

const STATUS: Record<PhotonErrorCode, number> = {
  invalid_phone: 400,
  not_configured: 500,
  groups_unsupported: 403,
};

// Dev-only endpoint for trying Photon from curl. One number sends a DM, two
// create a group chat: {"phones": ["+15551234567"], "text": "hi"}
// It 404s in production so a deployed site can't be used to text arbitrary
// numbers.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { phones, text } = body ?? {};
  if (!isOneOrTwoPhones(phones) || typeof text !== "string" || !text.trim()) {
    return Response.json(
      {
        error:
          'Send JSON like {"phones": ["+15551234567"], "text": "hi"} with one or two numbers.',
      },
      { status: 400 },
    );
  }

  try {
    const result =
      phones.length === 1
        ? await sendDirectMessage(phones[0], text)
        : await createGroupChat(phones, text);
    return Response.json(result);
  } catch (error) {
    if (error instanceof PhotonError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: STATUS[error.code] },
      );
    }
    // Log text only: SDK/gRPC error objects can carry request metadata.
    console.error("[photon]", error instanceof Error ? error.stack : String(error));
    return Response.json(
      { error: "Photon request failed. Check the dev server log." },
      { status: 502 },
    );
  }
}

function isOneOrTwoPhones(value: unknown): value is [string] | [string, string] {
  return (
    Array.isArray(value) &&
    (value.length === 1 || value.length === 2) &&
    value.every((phone) => typeof phone === "string")
  );
}
