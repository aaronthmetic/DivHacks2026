import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export class InputError extends Error {}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("A JSON object is required.");
  }
  return value as Record<string, unknown>;
}

export function onlyFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new InputError("This request contains fields that cannot be changed.");
  }
}

export function nameField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    throw new InputError(`${label} must be between 1 and 100 characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new InputError(`${label} contains invalid characters.`);
  return value.trim();
}

export function names(body: Record<string, unknown>) {
  const firstName = nameField(body.firstName, "First name");
  const lastName = nameField(body.lastName, "Last name");
  return { firstName, lastName, name: `${firstName} ${lastName}` };
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new InputError("Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InputError("Enter a valid email address.");
  }
  return email;
}

// API callers send international numbers; the UI supplies an explicit country.
export function normalizePhone(value: unknown, country?: CountryCode): string {
  if (typeof value !== "string") throw new InputError("Enter a valid phone number.");
  const trimmed = value.trim();
  if (trimmed.length > 40 || (!country && !trimmed.startsWith("+"))) {
    throw new InputError("Enter a valid phone number including its country code.");
  }
  const phone = parsePhoneNumberFromString(trimmed, { defaultCountry: country, extract: false });
  if (phone?.ext) throw new InputError("Enter a phone number without an extension.");
  if (!phone?.isValid()) throw new InputError("Enter a valid phone number.");
  return phone.number;
}

export function registration(body: Record<string, unknown>) {
  onlyFields(body, ["firstName", "lastName", "name", "email", "phoneNumber", "password", "callbackURL", "rememberMe"]);
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
    throw new InputError("Password must be between 12 and 128 characters.");
  }
  return { ...names(body), email: normalizeEmail(body.email), phoneNumber: normalizePhone(body.phoneNumber), password: body.password };
}

export function isProfileComplete(user: {
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  profileCompletedAt?: Date | string | null;
}) {
  return Boolean(user.firstName?.trim() && user.lastName?.trim() && user.phoneNumber && user.profileCompletedAt);
}

export const conflictMessage = "That email or phone number is already in use. Sign in using your existing method.";
