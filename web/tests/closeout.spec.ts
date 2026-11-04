import { expect, test } from "@playwright/test";
import { closedAs } from "../src/closeout";
import { duration, timeText } from "../src/timetext";

// Real close reasons from the house tracker, 2026-11-04, then the rest of the rule's words and its edges.
const TABLE: [string, "done" | "rejected"][] = [
  ["superseded by csb-b1325a: recreated without the milestone label it inherited from its parent", "rejected"],
  ["superseded: the house retired seed s10 on 2026-11-04", "rejected"],
  ["duplicate of pg-35e860 (closed by pg-lead for ui-build)", "rejected"],
  ["duplicate of pg-0760e7, created while testing kind milestone", "rejected"],
  ["cleanup and plan done", "done"],
  ["landed 7b222c50e: ops/skins/fix-socket.ts, sockets on 19 models", "done"],
  ["verified built ee5fb0e86: experts/brain-researcher.md:1", "done"],
  ["limit cleared by reset", "done"],
  ["Already answered and taken: notes/review/systems-q67-families-2026-11-02.md", "done"],
  ["not in the battle lane: the sentence is the ui-build page clock", "done"],
  ["48e8d8e76", "done"],
  ["Rejected by Oleg", "rejected"], ["DROPPED", "rejected"], ["cancelled, no longer wanted", "rejected"],
  ["won't do", "rejected"], ["won’t do", "rejected"], ["wontfix", "rejected"], ["not needed now", "rejected"],
  ["  obsolete after the rewrite", "rejected"], ["fixed the superseded path", "done"], ["", "done"],
];
for (const [reason, want] of TABLE) test(`close reason ${JSON.stringify(reason)} reads ${want}`, () => { expect(closedAs(reason)).toBe(want); });
test("no reason at all reads done", () => { expect(closedAs(undefined)).toBe("done"); });

const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();
const TIMES: [string, number, number, boolean, boolean, string][] = [
  ["same day, minutes", at(4, 14, 3), at(4, 14, 9), false, false, "14:03-14:09, 6 min"],
  ["same day, hours", at(4, 9, 0), at(4, 12, 30), false, false, "09:00-12:30, 3 h 30 min"],
  ["an instant", at(4, 14, 3), at(4, 14, 3), false, false, "14:03"],
  ["live today", at(4, 14, 0), at(4, 14, 20), true, false, "14:00-now, 20 min"],
  ["several days", at(1, 9, 0), at(4, 9, 0), false, false, "1 Nov - 4 Nov, 3 d"],
  ["live across days", at(1, 9, 0), at(4, 9, 0), true, false, "1 Nov - now, 3 d"],
  ["unmeasured start", at(4, 14, 3), at(4, 14, 9), false, true, "about 14:03-14:09, 6 min"],
];
for (const [name, s, e, live, approx, want] of TIMES) test(`time text: ${name}`, () => { expect(timeText(s, e, live, approx)).toBe(want); });
test("duration rounds to whole hours without a zero", () => { expect(duration(7200e3)).toBe("2 h"); });
