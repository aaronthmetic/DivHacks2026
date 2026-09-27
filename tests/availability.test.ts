import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAvailability, isValidAvailability, toMinutes } from "../lib/availability";

test("valid availability has 1 to 7 windows on distinct days, each ending after it starts", () => {
  assert.equal(isValidAvailability([{ day: 1, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }]), true);
  assert.equal(isValidAvailability([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: 0, end: 1439 }))), true);
  const invalid: unknown[] = [
    undefined, [], "Mon", [null],
    [{ day: 1, start: 600, end: 600 }], [{ day: 1, start: 700, end: 600 }],
    [{ day: 7, start: 0, end: 60 }], [{ day: -1, start: 0, end: 60 }], [{ day: 1.5, start: 0, end: 60 }],
    [{ day: 1, start: -1, end: 60 }], [{ day: 1, start: 0, end: 1440 }], [{ day: 1, start: "09:00", end: 60 }],
    [{ day: 1, start: 0, end: 60 }, { day: 1, start: 90, end: 120 }],
  ];
  for (const windows of invalid) assert.equal(isValidAvailability(windows), false, JSON.stringify(windows));
});

test("time input values convert to minutes after midnight", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("17:30"), 1050);
  assert.equal(toMinutes("23:59"), 1439);
  for (const bad of ["24:00", "9:00", "17:60", "5pm", "17:30:00", ""]) assert.equal(toMinutes(bad), null, bad);
});

test("availability reads Monday first with shared hours grouped", () => {
  assert.equal(formatAvailability([{ day: 6, start: 600, end: 840 }, { day: 1, start: 1020, end: 1200 }, { day: 3, start: 1020, end: 1200 }]), "Mon, Wed 5–8 PM · Sat 10 AM–2 PM");
  assert.equal(formatAvailability([{ day: 0, start: 540, end: 1020 }, { day: 2, start: 1050, end: 1200 }]), "Tue 5:30–8 PM · Sun 9 AM–5 PM");
  assert.equal(formatAvailability([{ day: 5, start: 0, end: 720 }]), "Fri 12 AM–12 PM");
  assert.equal(formatAvailability([]), "Availability not listed");
  assert.equal(formatAvailability(undefined), "Availability not listed");
});
