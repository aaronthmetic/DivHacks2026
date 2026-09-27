import { sendDirectMessage } from "./photon";
import type { Messenger } from "./texting";

// The real messenger. Photon's SDK sends over gRPC, so routes using it run on Node, never edge.
export const photonMessenger: Messenger = {
  async send(phoneNumber, text) {
    await sendDirectMessage(phoneNumber, text);
  },
};
