"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type InputHTMLAttributes, type SVGProps } from "react";
import type { CountryCode } from "libphonenumber-js";
import countryOptions from "@/lib/country-options.json";
import { normalizeEmail, normalizePhone } from "@/lib/auth-validation";
import { cn } from "@/lib/utils";
import { profileInput, profilePrimaryButton } from "@/components/profile/styles";

// Control styles from the auth mockups: 3px-bordered fields and buttons, with text centered on
// phones and left-aligned on desktop.
const control = "h-[55px] w-full rounded-[10px] text-xl font-extrabold disabled:opacity-60 lg:h-[77px]";
const field = cn(control, "block border-[3px] border-barter-line bg-white px-4 text-center text-black outline-none placeholder:text-barter-gray focus:border-barter-navy lg:px-5 lg:text-left");
const button = cn(control, "flex items-center outline-offset-2 focus-visible:outline-[3px] focus-visible:outline-barter-blue");
const primaryButton = cn(button, "justify-center bg-barter-navy text-white transition-opacity hover:opacity-90 lg:text-[32px]");
const outlineButton = cn(button, "border-[3px] border-barter-line bg-white px-4 text-barter-gray transition-colors hover:bg-neutral-50 lg:px-5");
const stack = "space-y-[15px] lg:space-y-[22px]";
const nameRow = "grid gap-[15px] lg:grid-cols-2 lg:gap-[18px]";

// The mockups show placeholders only, so the label is kept for screen readers.
function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block"><span className="sr-only">{label}</span><input className={field} placeholder={label} {...props} /></label>;
}

function CountryField({ country, setCountry }: { country: CountryCode | ""; setCountry: (country: CountryCode | "") => void }) {
  // Bundled labels are identical on Node and browsers with different ICU versions.
  return <label className="block"><span className="sr-only">Phone country</span>
    <select name="country" value={country} onChange={(event) => setCountry(event.target.value as CountryCode | "")}
      className={cn(field, "appearance-none [text-align-last:center] lg:[text-align-last:left] [&_option]:text-black", !country && "text-barter-gray")}>
      <option value="">Phone country</option>
      {countryOptions.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
    </select>
  </label>;
}

async function api(path: string, body: unknown, method = "POST") {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error("Too many attempts. Please wait a minute and try again.");
    throw new Error(data?.error?.message ?? data?.message ?? "We could not complete your request. Please try again.");
  }
  return data;
}

function Message({ error }: { error: string }) {
  return error ? <p role="alert" className="rounded-[10px] border-[3px] border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-bold text-red-700 lg:text-left">{error}</p> : null;
}

function OrDivider() {
  return <div className="flex items-center gap-4 py-1 lg:gap-5 lg:py-1.5">
    <span className="h-[3px] flex-1 bg-barter-line lg:hidden" />
    <span className="text-xl leading-none font-extrabold lg:text-[40px]">or</span>
    <span className="h-[3px] flex-1 bg-barter-line" />
  </div>;
}

// Google's standard "G" mark for sign-in buttons.
function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 48 48" aria-hidden {...props}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

export function AuthForm({ mode, googleEnabled, oauthError = false }: { mode: "login" | "register"; googleEnabled: boolean; oauthError?: boolean }) {
  const router = useRouter();
  const [country, setCountry] = useState<CountryCode | "">("");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(oauthError ? "Google sign-in could not be completed. Try again, or use the sign-in method you originally registered with." : "");
  const register = mode === "register";
  // The login field is labelled "Email" as in the mockup but also accepts a phone number;
  // a national-format number (no leading "+") needs a country.
  const loginPhone = !register && /^\+?[\d\s().-]+$/.test(identifier.trim());
  const needsCountry = loginPhone && !identifier.trim().startsWith("+");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const password = form.get("password");
      if (register) {
        const firstName = String(form.get("firstName")).trim();
        const lastName = String(form.get("lastName")).trim();
        await api("/api/auth/sign-up/email", { firstName, lastName, name: `${firstName} ${lastName}`, email: normalizeEmail(form.get("email")), phoneNumber: normalizePhone(form.get("phoneNumber"), country || undefined), password });
      } else if (loginPhone) {
        await api("/api/auth/sign-in/phone-number", { phoneNumber: normalizePhone(identifier, country || undefined), password });
      } else {
        await api("/api/auth/sign-in/email", { email: normalizeEmail(identifier), password });
      }
      router.replace("/"); router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to connect. Please try again.");
      setBusy(false);
    }
  }

  async function google() {
    if (busy) return;
    setError(""); setBusy(true);
    try {
      const result = await api("/api/auth/sign-in/social", { provider: "google" });
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com") throw new Error("Google sign-in is unavailable.");
      window.location.assign(url.href);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Google sign-in is unavailable."); setBusy(false);
    }
  }

  return <div className={stack}>
    <Message error={error} />
    <form method="post" onSubmit={submit}>
      <fieldset disabled={busy} className={stack}>
        {register ? <>
          <div className={nameRow}><Field label="First Name" name="firstName" autoComplete="given-name" maxLength={100} required /><Field label="Last Name" name="lastName" autoComplete="family-name" maxLength={100} required /></div>
          <Field label="Email" name="email" type="email" autoComplete="email" required maxLength={254} />
          <CountryField country={country} setCountry={setCountry} />
          <Field label="Phone number" name="phoneNumber" type="tel" autoComplete="tel" required maxLength={40} />
        </> : <>
          <Field label="Email or phone number" placeholder="Email" name="identifier" autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          {needsCountry && <CountryField country={country} setCountry={setCountry} />}
        </>}
        <Field label="Password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 12 : undefined} maxLength={128} required />
        <button type="submit" className={primaryButton}>{busy ? "Please wait…" : register ? "Create account" : "Login"}</button>
      </fieldset>
    </form>
    {googleEnabled && <>
      <OrDivider />
      <button type="button" className={cn(outlineButton, "justify-center gap-3 px-3 text-[13px] whitespace-nowrap lg:justify-start lg:gap-[22px] lg:px-5 lg:text-xl")} disabled={busy} onClick={google}>
        <GoogleIcon className="size-5 shrink-0 lg:size-[34px]" />Continue with Google
      </button>
    </>}
    <p className="text-center text-[13px] font-extrabold text-barter-gray lg:text-left lg:text-base">
      {register ? "Already have an account? " : "New here? "}
      <Link href={register ? "/login" : "/register"} className="text-barter-blue hover:underline">{register ? "Log in" : "Create an account"}</Link>
    </p>
  </div>;
}

export function ProfileForm({ firstName, lastName, complete = false }: { firstName: string; lastName: string; complete?: boolean }) {
  const router = useRouter();
  const [country, setCountry] = useState<CountryCode | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setSaved(false);
    const form = new FormData(event.currentTarget);
    try {
      await api(complete ? "/api/profile/complete" : "/api/profile", {
        firstName: form.get("firstName"), lastName: form.get("lastName"),
        ...(complete ? { phoneNumber: normalizePhone(form.get("phoneNumber"), country || undefined) } : {}),
      }, complete ? "POST" : "PATCH");
      if (complete) router.replace("/");
      setSaved(true); router.refresh();
      if (!complete) setBusy(false);
    } catch (error) { setError(error instanceof Error ? error.message : "We could not save your profile."); setBusy(false); }
  }
  return <form method="post" onSubmit={submit} className={stack}>
    <Message error={error} />
    {saved && <p role="status" className="text-center text-sm font-bold text-barter-gray lg:text-left">Your profile has been saved.</p>}
    <fieldset disabled={busy} className={stack}>
      <div className={nameRow}>
        <Field label="First Name" className={complete ? field : profileInput} name="firstName" autoComplete="given-name" required maxLength={100} defaultValue={firstName} />
        <Field label="Last Name" className={complete ? field : profileInput} name="lastName" autoComplete="family-name" required maxLength={100} defaultValue={lastName} />
      </div>
      {complete && <><CountryField country={country} setCountry={setCountry} /><Field label="Phone number" name="phoneNumber" type="tel" autoComplete="tel" required maxLength={40} /></>}
      <button type="submit" className={complete ? primaryButton : profilePrimaryButton}>{busy ? "Saving…" : complete ? "Confirm and continue" : "Save changes"}</button>
    </fieldset>
  </form>;
}

export function LogoutButton({ className }: { className?: string } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return <div className="space-y-3"><Message error={error} /><button type="button" className={className ?? cn(outlineButton, "justify-center")} disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await api("/api/auth/sign-out", {}); router.replace("/login"); router.refresh(); }
    catch { setError("We could not log you out. Please try again."); setBusy(false); }
  }}>{busy ? "Logging out…" : "Log out"}</button></div>;
}
