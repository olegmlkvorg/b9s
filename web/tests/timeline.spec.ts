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

test("the default window is 3d, every bar has its own row, epics head their sections, and Back returns to Timeline", async ({ page, project }) => {
  await open(page, project);
  await page.locator('#bar [data-view="timeline"]').click();
  const v = page.locator("#vTimeline");
  await expect(v.locator('[data-tlwin="3d"]')).toHaveAttribute("aria-pressed", "true");
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

test.describe("rows", () => {
  test.use({ fixture: { issues: [
    { id: "t-a", title: "[a] One", status: "in_progress", assignee: "cara" },
    { id: "t-b", title: "[b] Two", status: "in_progress", assignee: "cara" },
    { id: "t-c", title: "[c] Three", status: "in_progress", assignee: "cara" },
    { id: "t-d", title: "[d] Four", status: "closed", assignee: "cara" },
  ] } });
  test("overlapping bars in one lane each get their own row", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    const bars = page.locator("#vTimeline .tlbar");
    await expect(bars).toHaveCount(4);
    await expect(page.locator("#vTimeline .tllane:not(.tlaxis)")).toHaveCount(1);
    const r = (await bars.evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return [b.top, b.bottom]; }))).sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < r.length; k++) expect(r[k][0]).toBeGreaterThanOrEqual(r[k - 1][1] - 0.5);
  });
});

test.describe("states", () => {
  const WIDE = { startedMinutesAgo: 1000, updatedMinutesAgo: 30 };
  test.use({ fixture: { issues: [
    { id: "t-o", title: "[o] Planned", assignee: "cara", dueInMinutes: 2000 },
    { id: "t-p", title: "[p] Moving", status: "in_progress", assignee: "cara", startedMinutesAgo: 1000 },
    { id: "t-b", title: "[b] Stuck", status: "in_progress", assignee: "cara", blockedBy: ["t-o"], ...WIDE },
    { id: "t-d", title: "[d] Finished", status: "closed", closeReason: "landed abc123", assignee: "cara", ...WIDE },
    { id: "t-r", title: "[r] Dropped", status: "closed", closeReason: "superseded by t-d", assignee: "cara", ...WIDE },
  ] } });
  const CASES = [["t-o", "s-open", "○"], ["t-p", "s-progress", "●"], ["t-b", "s-blocked", "⊘"], ["t-d", "s-done", "✓"], ["t-r", "s-rejected", "✕"]] as const;

  test("each bar carries its state and mark, the legend shows the same five, and a rejected title is struck", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    const v = page.locator("#vTimeline");
    for (const [id, cls, mark] of CASES) {
      await expect(v.locator(`[data-tl="${id}"]`)).toHaveClass(new RegExp(cls));
      await expect(v.locator(`[data-tl="${id}"] .tlmk`)).toHaveText(mark);
      await expect(v.locator(`.tlkey .${cls} .tlmk`)).toHaveText(mark);
    }
    await expect(v.locator('[data-tl="t-r"] .t')).toHaveCSS("text-decoration-line", "line-through");
    await expect(v.locator('[data-tl="t-d"] .t')).not.toHaveCSS("text-decoration-line", "line-through");
    await expect(v.locator('[data-tl="t-d"]')).toHaveAttribute("title", /^Finished\n\S+.*, \d+ (h|min)/);
    expect((await v.locator('[data-tl="t-d"]').getAttribute("title"))!.split("\n")).toHaveLength(2);
    expect(await v.locator('[data-tl="t-d"]').getAttribute("title")).not.toMatch(/cara|done|t-d/);
    await expect(v.locator('[data-tl="t-r"]')).toHaveAttribute("aria-label", /closed, rejected \(superseded by t-d\)/);
  });

  // In grayscale, so a pair that differs only by hue fails. The legend swatches are one size, so pixels compare directly.
  test("the five swatches differ pixel by pixel with colour removed", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    await page.addStyleTag({ content: "#vTimeline { filter: grayscale(1); }" });
    const shots: string[] = [];
    for (const [, cls] of CASES) shots.push((await page.locator(`#vTimeline .tlkey .${cls} .tlfill`).screenshot()).toString("base64"));
    const px = await page.evaluate(async list => Promise.all(list.map(async b64 => {
      const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
      const c = document.createElement("canvas"); c.width = 22; c.height = 12;
      const g = c.getContext("2d")!; g.drawImage(im, 0, 0, 22, 12);
      return Array.from(g.getImageData(0, 0, 22, 12).data).filter((_, k) => k % 4 === 0);
    })), shots);
    for (let a = 0; a < px.length; a++) for (let b = a + 1; b < px.length; b++) {
      const mean = px[a].reduce((s, x, k) => s + Math.abs(x - px[b][k]), 0) / px[a].length;
      expect(mean, `${CASES[a][1]} vs ${CASES[b][1]}`).toBeGreaterThan(8);
    }
  });
});

test.describe("refresh", () => {
  const LIST = Array.from({ length: 60 }, (_, n) => ({ id: `t-${n}`, title: `[${n}] Item ${n}`, status: "in_progress", assignee: `who${n}`, startedMinutesAgo: 300 }));
  test.use({ fixture: { issues: LIST } });
  const box = '#vTimeline .tlscroll';

  test("an outside write keeps the timeline's scroll and the open item", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    await page.locator(box).evaluate(b => { b.scrollTop = 400; });
    await page.locator('[data-tl="t-20"]').evaluate(b => (b as HTMLElement).click());
    await expect(page.locator("#detailHost")).toContainText("Item 20");
    await page.locator(box).evaluate(b => { b.scrollTop = 400; });
    project.writeIssues([...LIST, { id: "t-new", title: "[new] Arrived", status: "in_progress", assignee: "zed", startedMinutesAgo: 300 }]);
    await expect(page.locator('[data-tl="t-new"]')).toHaveCount(1, { timeout: 10000 });
    expect(await page.locator(box).evaluate(b => b.scrollTop)).toBe(400);
    await expect(page.locator("#detailHost")).toContainText("Item 20");
  });

  test("the tree keeps its place through an outside write", async ({ page, project }) => {
    await open(page, project);
    await page.locator("#treeList").evaluate(b => { b.scrollTop = 300; });
    project.writeIssues([...LIST, { id: "t-new", title: "[new] Arrived", status: "in_progress", assignee: "zed", startedMinutesAgo: 300 }]);
    await expect(page.locator("#treeRows")).toContainText("Arrived", { timeout: 10000 });
    expect(await page.locator("#treeList").evaluate(b => b.scrollTop)).toBe(300);
  });
});

test.describe("place and focus", () => {
  // m-1 runs from before the window's middle to a far due date, so its label starts at the bar and a sideways scroll can hide it.
  const many = Array.from({ length: 40 }, (_, n) => ({ id: `m-${n}`, title: `[${n}] A long enough item title ${n}`, status: "in_progress", assignee: n % 2 ? "bob" : "alice", ...(n === 1 ? { startedMinutesAgo: 1200, dueInMinutes: 3000 } : {}) }));
  test.use({ fixture: { issues: [...many,
    { id: "o-1", title: "[50] Far blocker with no dates", status: "open" },
    { id: "o-2", title: "[51] Waits on far work", status: "in_progress", assignee: "bob", blockedBy: ["o-1"], startedMinutesAgo: 60 },
  ] } });

  test("a full reload keeps the timeline's scroll, and a fresh session does not", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    const box = page.locator("#vTimeline .tlscroll");
    await expect(box).toBeVisible();
    await box.evaluate(b => { b.scrollTop = 300; });
    await page.waitForFunction(() => (sessionStorage.getItem("b9s.scroll.timeline") || "").includes('"top":300'));
    await page.reload();
    await expect(page.locator("#vTimeline .tlscroll")).toBeVisible();
    await expect.poll(() => page.locator("#vTimeline .tlscroll").evaluate(b => b.scrollTop)).toBe(300);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.locator("#vTimeline .tlscroll")).toBeVisible();
    expect(await page.locator("#vTimeline .tlscroll").evaluate(b => b.scrollTop)).toBe(0);
  });

  test("hovering a bar whose blocker has no bar draws the dashed stub and names the blocker", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    const v = page.locator("#vTimeline"), bar = v.locator('[data-tl="o-2"]');
    await expect(v.locator('[data-tl="o-1"]')).toHaveCount(0);
    await expect(bar).toHaveAttribute("title", /waits on .*Far blocker.*outside this view/);
    await bar.dispatchEvent("mouseover");
    await expect(v.locator('.tlarrows path.off[data-off="o-2"]')).toHaveCount(1);
  });

  test("opening an item leaves its label clear of the owner column and the rows where they were", async ({ page, project }) => {
    await open(page, project);
    await page.locator('#bar [data-view="timeline"]').click();
    const box = page.locator("#vTimeline .tlscroll"), v = page.locator("#vTimeline");
    await expect(box).toBeVisible();
    await box.evaluate(b => { b.scrollLeft = 400; });
    if (page.viewportSize()!.width < 600) expect(await box.evaluate(b => b.scrollLeft)).toBeGreaterThan(100);
    const top = await v.locator('[data-tl="m-1"]').evaluate(e => e.getBoundingClientRect().top);
    await v.locator('[data-tl="m-1"]').dispatchEvent("click");
    await expect(page.locator(".detail")).toHaveAttribute("data-id", "m-1");
    const gap = await v.locator('[data-tl="m-1"] .tllab').evaluate(l => l.getBoundingClientRect().left - document.querySelector("#vTimeline .tlwho")!.getBoundingClientRect().right);
    expect(gap).toBeGreaterThanOrEqual(0);
    if (page.viewportSize()!.width >= 600) expect(await v.locator('[data-tl="m-1"]').evaluate(e => e.getBoundingClientRect().top)).toBe(top);
  });
});
