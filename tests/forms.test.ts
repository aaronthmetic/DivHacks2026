import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AuthForm, ProfileForm } from "../components/auth/forms";

test("unhydrated credential and profile forms never default to GET", () => {
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  for (const form of [
    createElement(AuthForm, { mode: "login", googleEnabled: false }),
    createElement(AuthForm, { mode: "register", googleEnabled: false }),
    createElement(ProfileForm, { firstName: "", lastName: "", complete: true }),
  ]) {
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, form));
    assert.match(html, /<form[^>]*method="post"/);
  }
});
