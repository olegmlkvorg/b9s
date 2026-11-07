import { expect, longPress, open, test, type FixtureIssue } from "./harness";

// The vertical chips: one chip per id prefix, and inside the house prefix one per issue labelled
// "vertical" plus "house ops" for the rest. Empty selection means all. src/verticals.ts.
const ISSUES: FixtureIssue[] = [
  { id: "pg-1", title: "[1] pg open" },
  { id: "pg-c78b3e", title: "[c78b3e] pg lookalike of gc" },
  { id: "pg-2", title: "[2] pg done", status: "closed" },
  { id: "gc-1", title: "[1] gc open" },
  { id: "spc-1", title: "[1] spc open" },
  { id: "house-ikb", title: "[ikb] Vertical epic", type: "epic", labels: ["vertical"] },
  { id: "house-ikb.1", title: "[ikb.1] dotted child", parent: "house-ikb" },
  { id: "house-q9", title: "[q9] child by parent link only", parent: "house-ikb" },
  { id: "house-sub", title: "[sub] labelled child of a labelled epic", parent: "house-ikb", labels: ["vertical"] },
  { id: "house-loose", title: "[loose] house ops item" },
];
test.use({ fixture: { issues: ISSUES } });

const chip = (page: import("@playwright/test").Page, k: string) => page.locator(`#verts [data-vert="${k}"]`);
const ids = (page: import("@playwright/test").Page) => page.locator("#treeRows .row[data-id]").evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id).sort());

test("a chip per vertical with open counts; house splits by the vertical label, a labelled child folds into its parent", async ({ page, project }) => {
  await open(page, project);
  expect(await page.locator("#verts [data-vert]").evaluateAll(els => els.map(e => (e as HTMLElement).dataset.vert))).toEqual(["gc", "pg", "spc", "house", "house-ikb"]);
  await expect(chip(page, "pg")).toContainText("2");      // pg-1 and pg-c78b3e; pg-2 is closed
  await expect(chip(page, "house-ikb")).toContainText("4"); // epic, dotted child, parent-link child, labelled child
  await expect(chip(page, "house")).toContainText("1");
  await expect(page.locator("#verts .vhid")).toHaveCount(0);
  expect((await ids(page)).length).toBe(9);
});

test("tapping chips toggles a set, 'N hidden' says what is off, All and the last chip off return to everything", async ({ page, project }) => {
  await open(page, project);
  await chip(page, "gc").click();
  expect(await ids(page)).toEqual(["gc-1"]);
  await expect(page.locator("#verts .vhid")).toHaveText("4 hidden");
  await chip(page, "spc").click();
  expect(await ids(page)).toEqual(["gc-1", "spc-1"]);
  await expect(chip(page, "gc")).toHaveAttribute("aria-pressed", "true");
  await chip(page, "gc").click();
  await chip(page, "spc").click();
  expect((await ids(page)).length).toBe(9);
  await chip(page, "pg").click();
  await page.locator("#verts [data-vertall]").click();
  expect((await ids(page)).length).toBe(9);
  await chip(page, "house-ikb").click();
  expect(await ids(page)).toEqual(["house-ikb", "house-ikb.1", "house-q9", "house-sub"]);
});

test("a long press shows one vertical alone, and again returns to all", async ({ page, project }) => {
  await open(page, project);
  await chip(page, "gc").click();
  await chip(page, "spc").click();
  await longPress(page, '#verts [data-vert="pg"]');
  expect(await ids(page)).toEqual(["pg-1", "pg-c78b3e"]);
  await longPress(page, '#verts [data-vert="pg"]');
  expect((await ids(page)).length).toBe(9);
});

test("the choice is remembered, written to ?v=, and a URL wins over storage", async ({ page, project }) => {
  await open(page, project);
  await chip(page, "spc").click();
  await expect.poll(() => page.url()).toContain("v=spc");
  expect(await page.evaluate(() => localStorage.getItem("b9s.verticals"))).toBe('["spc"]');
  await page.goto(project.url);                // no ?v=: storage
  await expect(page.locator("#boot")).toBeHidden();
  expect(await ids(page)).toEqual(["spc-1"]);
  await page.goto(project.url + "?v=gc");      // URL beats storage
  await expect(page.locator("#boot")).toBeHidden();
  expect(await ids(page)).toEqual(["gc-1"]);
  await page.goto(project.url + "?v=nope");    // a stale id never hides everything
  await expect(page.locator("#boot")).toBeHidden();
  expect((await ids(page)).length).toBe(9);
});

test("a typed in: query is exact: in:gc does not match pg-c78b3e, while id:gc does", async ({ page, project }) => {
  await open(page, project);
  await page.locator('#bar [data-view="search"]').click();
  await page.locator("#sIn").fill("in:gc");
  await page.locator("#sApply").click();
  expect(await ids(page)).toEqual(["gc-1"]);
  await page.locator('#bar [data-view="search"]').click();
  await page.locator("#sIn").fill("id:gc");
  await page.locator("#sApply").click();
  expect(await ids(page)).toContain("pg-c78b3e");
});
