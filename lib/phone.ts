// E.164: "+", a country code, then the number; 15 digits at most.
const E164 = /^\+[1-9]\d{1,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}
