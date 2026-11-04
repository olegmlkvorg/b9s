import { expect, open, test } from "./harness";

// The timeline draws started, live and closed work as bars on a time axis; an
// open issue with no start and no due date has no place on it.
test("the timeline draws live and closed work, leaves unscheduled work out, and a bar opens the detail", async ({ page, project }) => {
  await open(page, project);
  await page.locator('#bar [data-view="timeline"]').click();
  const v = page.locator("#vTimeline");
  await expect(v).toBeVisible();
  await expect(v.locator('[data-tl="t-1"]')).toBeVisible();
  await expect(v.locator('[data-tl="t-1"]')).toHaveAttribute("aria-label", /alice, in progress/);
  await expect(v.locator('[data-tl="t-4"]')).toHaveCount(1);
  await expect(v.locator('[data-tl="t-2"]')).toHaveCount(0);
  await expect(v.locator(".tlnow")).not.toHaveCount(0);
  await expect(v.locator(".tlwho", { hasText: "alice" })).toHaveCount(1);
  await v.locator('[data-tl="t-1"]').click();
  await expect(page.locator("#detailHost")).toContainText("Write the API");
});

test("the window chips change the span the timeline covers", async ({ page, project }) => {
  await open(page, project);
  await page.locator('#bar [data-view="timeline"]').click();
  const chip = page.locator('#vTimeline [data-tlwin="12h"]');
  await chip.click();
  await expect(page.locator('#vTimeline [data-tlwin="12h"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#vTimeline [data-tl="t-1"]')).toBeVisible();
});

test("the default window fits the work, every bar has its own row, epics head their sections, and Back returns to Timeline", async ({ page, project }) => {
  await open(page, project);
  await page.locator('#bar [data-view="timeline"]').click();
  const v = page.locator("#vTimeline");
  await expect(v.locator('[data-tlwin="fit"]')).toHaveAttribute("aria-pressed", "true");
  await expect(v.locator(".tlgroup", { hasText: "Epic: Mobile web" })).toHaveCount(1);
  const tops = await v.locator(".tlbar").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }));
  const sorted = tops.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < sorted.length; k++) expect(sorted[k][0]).toBeGreaterThanOrEqual(sorted[k - 1][1]);
  const w = await v.locator('[data-tl="t-1"] .tlfill').evaluate(e => e.getBoundingClientRect().width);
  expect(w).toBeGreaterThanOrEqual(6);
  await v.locator('[data-tl="t-1"]').click();
  await expect(page.locator(".detail")).toHaveAttribute("data-id", "t-1");
  // A split layout shows the detail as a pane with no Back; a phone sheet names the view it returns to.
  if (await page.locator('.detail .back[data-act="dclose"]').count()) await expect(page.locator('.detail .back[data-act="dclose"]')).toHaveText("‹ Timeline");
});

test.describe("arrows", () => {
  test.use({ fixture: { issues: [
    { id: "t-4", title: "[4] Done first", status: "closed" },
    { id: "t-7", title: "[7] Then this", status: "in_progress", assignee: "bob", blockedBy: ["t-4"] },
  ] } });
  test("a dependency arrow shows only while its bar is hovered", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    const v = page.locator("#vTimeline");
    await expect(v.locator('[data-tl="t-7"]')).toBeVisible();
    await expect(v.locator(".tlarrows > path")).toHaveCount(0);
    await v.locator('[data-tl="t-7"]').hover();
    await expect(v.locator(".tlarrows path.hot")).toHaveCount(1);
  });
});
