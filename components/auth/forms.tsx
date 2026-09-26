"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import type { CountryCode } from "libphonenumber-js";
import countryOptions from "@/lib/country-options.json";
import { Button } from "@/components/ui/button";
import { normalizeEmail, normalizePhone } from "@/lib/auth-validation";

const inputClass = "mt-1 block h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-sm font-medium">{label}<input className={inputClass} {...props} /></label>;
}

function CountryField({ country, setCountry }: { country: CountryCode; setCountry: (country: CountryCode) => void }) {
  // Bundled labels are identical on Node and browsers with different ICU versions.
  return <label className="block text-sm font-medium">Phone country
    <select name="country" className={inputClass} value={country} onChange={(event) => setCountry(event.target.value as CountryCode)}>
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
  return error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null;
}

export function AuthForm({ mode, googleEnabled, oauthError = false }: { mode: "login" | "register"; googleEnabled: boolean; oauthError?: boolean }) {
  const router = useRouter();
  const [country, setCountry] = useState<CountryCode>("US");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(oauthError ? "Google sign-in could not be completed. Try again, or use the sign-in method you originally registered with." : "");
  const register = mode === "register";

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
        await api("/api/auth/sign-up/email", { firstName, lastName, name: `${firstName} ${lastName}`, email: normalizeEmail(form.get("email")), phoneNumber: normalizePhone(form.get("phoneNumber"), country), password });
      } else if (identifier.includes("@")) {
        await api("/api/auth/sign-in/email", { email: normalizeEmail(identifier), password });
      } else {
        await api("/api/auth/sign-in/phone-number", { phoneNumber: normalizePhone(identifier, country), password });
      }
      router.replace("/profile"); router.refresh();
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

  return <div className="space-y-5">
    <Message error={error} />
    <form method="post" onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        {register ? <>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="First name" name="firstName" autoComplete="given-name" maxLength={100} required /><Field label="Last name" name="lastName" autoComplete="family-name" maxLength={100} required /></div>
          <Field label="Email" name="email" type="email" autoComplete="email" required maxLength={254} />
          <CountryField country={country} setCountry={setCountry} />
          <Field label="Phone number" name="phoneNumber" type="tel" autoComplete="tel" required maxLength={40} />
        </> : <>
          <Field label="Email or phone number" name="identifier" autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          {!identifier.includes("@") && <CountryField country={country} setCountry={setCountry} />}
        </>}
        <Field label="Password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 12 : undefined} maxLength={128} required />
        {register && <p className="text-xs text-muted-foreground">Use 12–128 characters for your password.</p>}
        <Button type="submit" size="lg" className="w-full">{busy ? "Please wait…" : register ? "Create account" : "Log in"}</Button>
      </fieldset>
    </form>
    {googleEnabled && <><div className="text-center text-xs text-muted-foreground">or</div><Button type="button" variant="outline" size="lg" className="w-full" disabled={busy} onClick={google}>Continue with Google</Button></>}
    <p className="text-center text-sm text-muted-foreground">{register ? "Already have an account? " : "New here? "}<Link href={register ? "/login" : "/register"} className="text-foreground underline underline-offset-4">{register ? "Log in" : "Create an account"}</Link></p>
  </div>;
}

export function ProfileForm({ firstName, lastName, complete = false }: { firstName: string; lastName: string; complete?: boolean }) {
  const router = useRouter();
  const [country, setCountry] = useState<CountryCode>("US");
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
        ...(complete ? { phoneNumber: normalizePhone(form.get("phoneNumber"), country) } : {}),
      }, complete ? "POST" : "PATCH");
      if (complete) router.replace("/profile");
      setSaved(true); router.refresh();
      if (!complete) setBusy(false);
    } catch (error) { setError(error instanceof Error ? error.message : "We could not save your profile."); setBusy(false); }
  }
  return <form method="post" onSubmit={submit} className="space-y-4">
    <Message error={error} />
    {saved && <p role="status" className="text-sm">Your profile has been saved.</p>}
    <fieldset disabled={busy} className="space-y-4">
      <Field label="First name" name="firstName" autoComplete="given-name" required maxLength={100} defaultValue={firstName} />
      <Field label="Last name" name="lastName" autoComplete="family-name" required maxLength={100} defaultValue={lastName} />
      {complete && <><CountryField country={country} setCountry={setCountry} /><Field label="Phone number" name="phoneNumber" type="tel" autoComplete="tel" required maxLength={40} /></>}
      <Button type="submit" size="lg" className="w-full">{busy ? "Saving…" : complete ? "Confirm and continue" : "Save changes"}</Button>
    </fieldset>
  </form>;
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return <div className="space-y-3"><Message error={error} /><Button variant="outline" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await api("/api/auth/sign-out", {}); router.replace("/login"); router.refresh(); }
    catch { setError("We could not log you out. Please try again."); setBusy(false); }
  }}>{busy ? "Logging out…" : "Log out"}</Button></div>;
}
