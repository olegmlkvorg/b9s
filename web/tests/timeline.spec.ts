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
