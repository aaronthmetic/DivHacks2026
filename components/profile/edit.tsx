"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar } from "./view";

async function save(path: string, body: Record<string, unknown> | FormData | undefined, method: string) {
  const response = await fetch(path, { method, ...(body instanceof FormData ? { body } : body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || data?.message || "Could not save changes. Please try again.");
  // Auth cookies are uncached; refresh both the browser session and server page.
  await fetch("/api/auth/get-session", { cache: "no-store" });
  return data;
}
const input = "mt-1 block w-full rounded-lg border bg-background px-3 py-2";
function EditSection({ title, children, submit, reset = false }: { title: string; children: ReactNode; submit: (form: FormData) => Promise<unknown>; reset?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setMessage(""); setFailed(false);
    try { await submit(new FormData(form)); if (reset) form.reset(); setMessage("Changes saved."); router.refresh(); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save changes."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border bg-background p-6"><h2 className="mb-4 text-xl font-semibold">{title}</h2><form method="post" onSubmit={onSubmit}><fieldset disabled={busy} className="space-y-4">{children}<Button type="submit">{busy ? "Saving…" : "Save changes"}</Button></fieldset>{message && <p role={failed ? "alert" : "status"} className={`mt-4 text-sm ${failed ? "text-destructive" : ""}`}>{message}</p>}</form></section>;
}
export function ContactForm({ email, phone, hasPassword }: { email: string; phone: string; hasPassword: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function google() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/sign-in/social", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", reauthenticate: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Google sign-in is unavailable.");
      const url = new URL(data.url);
      if (url.origin !== "https://accounts.google.com") throw new Error("Google sign-in is unavailable.");
      window.location.assign(url.href);
    } catch (error) { setError(error instanceof Error ? error.message : "Google sign-in is unavailable."); setBusy(false); }
  }
  return <EditSection title="Contact details" submit={form => save("/api/profile", { email: form.get("email"), phoneNumber: form.get("phoneNumber"), ...(hasPassword ? { currentPassword: form.get("currentPassword") } : {}) }, "PATCH")}>
    <label className="block">Email<input className={input} name="email" type="email" autoComplete="email" maxLength={254} required defaultValue={email} /></label>
    <label className="block">Phone number (including country code)<input className={input} name="phoneNumber" type="tel" autoComplete="tel" maxLength={40} placeholder="+1 202 555 0123" required defaultValue={phone} /></label>
    {hasPassword ? <label className="block">Current password<input className={input} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label> : <><p className="text-sm text-muted-foreground">Sign in with Google again before changing contact details. Save your changes within five minutes of signing in.</p><Button type="button" variant="outline" disabled={busy} onClick={google}>{busy ? "Connecting…" : "Sign in with Google again"}</Button>{error && <p role="alert">{error}</p>}</>}
  </EditSection>;
}
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  if (!hasPassword) return <section className="rounded-xl border bg-background p-6"><h2 className="mb-3 text-xl font-semibold">Password</h2><p>Your password is managed by Google.</p></section>;
  return <EditSection title="Password" reset submit={form => {
    if (form.get("newPassword") !== form.get("confirmPassword")) throw new Error("The new passwords do not match.");
    return save("/api/auth/change-password", { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword"), revokeOtherSessions: true }, "POST");
  }}><input type="text" autoComplete="username" hidden readOnly aria-hidden="true" />
    <label className="block">Current password<input className={input} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
    <label className="block">New password<input className={input} name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
    <label className="block">Confirm new password<input className={input} name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
    <p className="text-sm text-muted-foreground">Use 12–128 characters. Your other sessions will be signed out.</p>
  </EditSection>;
}
export function PhotoForm({ image, name }: { image?: string | null; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function change(form?: HTMLFormElement) {
    if (busy) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const data = form ? new FormData(form) : undefined;
      const file = data?.get("image");
      if (form && (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) throw new Error("Choose a JPEG, PNG, or WebP image up to 5 MiB.");
      await save("/api/profile/image", data, form ? "POST" : "DELETE");
      form?.reset(); setMessage(form ? "Photo saved." : "Default photo restored."); router.refresh();
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save your photo."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border bg-background p-6"><h2 className="text-xl font-semibold">Profile picture</h2><Avatar src={image} name={name} large /><form method="post" encType="multipart/form-data" onSubmit={event => { event.preventDefault(); void change(event.currentTarget); }}><fieldset disabled={busy} className="space-y-4"><label className="block">Choose a photo<input className="mt-2 block w-full text-sm" type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label><p className="text-sm text-muted-foreground">JPEG, PNG, or WebP. Maximum 5 MiB.</p><Button type="submit">{busy ? "Saving…" : "Upload photo"}</Button><Button className="ml-3" variant="outline" type="button" onClick={() => change()}>Use default photo</Button></fieldset></form>{message && <p role={failed ? "alert" : "status"} className={failed ? "text-destructive" : ""}>{message}</p>}</section>;
}
