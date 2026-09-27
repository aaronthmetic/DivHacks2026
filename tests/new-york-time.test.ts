import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNewYork, fromNewYork, toNewYorkLocal } from "../lib/new-york-time";

test("New York wall clocks follow daylight saving time", () => {
  assert.equal(toNewYorkLocal(new Date("2026-10-03T15:00:00Z")), "2026-10-03T11:00");
  assert.equal(toNewYorkLocal(new Date("2026-12-05T16:00:00Z")), "2026-12-05T11:00");
  assert.equal(toNewYorkLocal(new Date("2026-10-05T04:00:00Z")), "2026-10-05T00:00");
  assert.equal(fromNewYork("2026-10-03T11:00")?.toISOString(), "2026-10-03T15:00:00.000Z");
  assert.equal(fromNewYork("2026-12-05T11:00")?.toISOString(), "2026-12-05T16:00:00.000Z");
  // The repeated hour when clocks fall back resolves to its first occurrence.
  assert.equal(fromNewYork("2026-11-01T01:30")?.toISOString(), "2026-11-01T05:30:00.000Z");
});

test("impossible or malformed New York times are rejected", () => {
  // Clocks skip from 2:00 to 3:00 AM on March 14, 2027.
  for (const local of ["2027-03-14T02:30", "2026-02-30T10:00", "2026-10-03 11:00", "2026-10-03T11", "", "tomorrow"]) {
    assert.equal(fromNewYork(local), null, local);
  }
});

test("booking times read like texts", () => {
  assert.equal(formatNewYork(new Date("2026-10-03T15:00:00Z")), "Sat, Oct 3 at 11 AM");
  assert.equal(formatNewYork(new Date("2026-10-03T15:30:00Z")), "Sat, Oct 3 at 11:30 AM");
  assert.equal(formatNewYork(new Date("2026-10-03T16:00:00Z")), "Sat, Oct 3 at 12 PM");
});
