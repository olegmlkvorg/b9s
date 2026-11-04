// The timeline view: a Gantt of the project's work. Sections are epics (inside each project when b9s shows all projects), and
// inside a section every issue gets its own row, grouped by assignee, so no two bars overlap. Each bar runs from when work began
// (started_at; else the planned start; else created, marked approximate) to closed, now, or the due date. A never-started issue
// with a due date is planned and drawn outlined. The default window ("fit") spans the open and in-progress work. "blocks"
// arrows are drawn for the critical path (the longest open chain) and for the hovered or opened issue only. The tree's text
// query and project filter apply; status chips do not, since closed work belongs on a timeline. A bar opens the detail.

import { D, ancestors, eff, get, pool, projectOf, shortId, type Item } from "./data";
import { S, stOf, textMatches } from "./state";
import { $, esc, parseTime, store } from "./util";

const H = 3600e3, DAY = 24 * H;
/** past: how far back the window reaches; ahead: how far past now. "fit" is computed from the items (fitWindow). */
export const WINDOWS = [
  { key: "fit", past: 0, ahead: 0 },
  { key: "12h", past: 12 * H, ahead: 2 * H }, { key: "3d", past: 3 * DAY, ahead: 8 * H },
  { key: "plan 7d", past: DAY, ahead: 7 * DAY }, { key: "plan 30d", past: 2 * DAY, ahead: 30 * DAY },
] as const;
export type WindowKey = typeof WINDOWS[number]["key"];
export const FIT_MIN = 12 * H, FIT_MAX = 45 * DAY;

export interface Bar { i: Item; start: number; end: number; approx: boolean; live: boolean; planned: boolean; x0: number; x1: number }
export interface Lane { group: string; owner: string; bars: Bar[] }

/** span places one issue in time, or null when it was never started and has no due date. */
export function span(i: Item, now: number): Omit<Bar, "i" | "x0" | "x1"> | null {
  const real = parseTime(i.started_at), closed = eff(i) === "closed", live = eff(i) === "in_progress";
  const plan = parseTime(i.planned_start) || parseTime(i.defer_until), due = parseTime(i.due);
  if (!real && !closed && !live) {
    if (!due) return null;
    const start = plan || Math.min(due, parseTime(i.created_at) || due);
    return { start, end: Math.max(start, due), approx: !plan, live: false, planned: true };
  }
  const start = real || plan || parseTime(i.created_at) || now;
  const end = closed ? parseTime(i.closed_at) || parseTime(i.updated_at) || now : live ? Math.max(now, parseTime(i.due) || 0) : parseTime(i.updated_at) || now;
  return { start, end: Math.max(start, end), approx: !real, live, planned: false };
}

/** fitWindow starts a tenth before the earliest unclosed bar (or now) and ends a tenth after the latest, at least FIT_MIN long;
 * past FIT_MAX it keeps the start, so the far-off due dates drop off the end rather than today's work off the start. */
export function fitWindow(items: Item[], now: number): { past: number; ahead: number } {
  let lo = now, hi = now;
  for (const i of items) {
    if (eff(i) === "closed") continue;
    const s = span(i, now); if (!s) continue;
    lo = Math.min(lo, s.start); hi = Math.max(hi, s.end);
  }
  const full = Math.min(FIT_MAX, Math.max(FIT_MIN, (hi - lo) * 1.2));
  const from = Math.min(lo - (full - Math.min(full, hi - lo)) / 2, now - full * 0.05);
  return { past: now - from, ahead: from + full - now };
}

/** epicOf names the section an issue sits in: its nearest epic ancestor (or itself when it is an epic), else "". */
export function epicOf(i: Item): string {
  if (i.type === "epic") return i.id;
  return ancestors(i.id).find(a => get(a)?.type === "epic") || "";
}

/** layout returns one lane per section and assignee in [now - past, now + ahead]; each bar is its own row, earliest first. */
export function layout(items: Item[], now: number, past: number, ahead: number, byProject: boolean): Lane[] {
  const from = now - past, full = past + ahead, lanes = new Map<string, Bar[]>();
  for (const i of items) {
    const s = span(i, now);
    if (!s || s.end < from || s.start > from + full) continue;
    const e = epicOf(i), ep = e ? get(e) : undefined;
    const group = (byProject ? projectOf(i) + " / " : "") + (ep ? ep.t : "No epic");
    const key = group + "\u0000" + (i.assignee || "");
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push({ i, ...s, x0: Math.max(0, (s.start - from) / full), x1: Math.min(1, (s.end - from) / full) });
  }
  const noEpic = (g: string) => g.endsWith("No epic") ? 1 : 0;
  return [...lanes].map(([key, bars]) => {
    const [group, owner] = key.split("\u0000");
    return { group, owner, bars: bars.sort((a, c) => a.start - c.start) };
  }).sort((a, b) => noEpic(a.group) - noEpic(b.group) || a.group.localeCompare(b.group) || (a.owner ? 0 : 1) - (b.owner ? 0 : 1)
    || Number(b.bars.some(x => x.live)) - Number(a.bars.some(x => x.live)) || a.owner.localeCompare(b.owner));
}

/** edges are [waiter, waited-on] for every blocks relation whose two ends are drawn. */
export function edges(bars: Bar[]): [string, string][] {
  const on = new Set(bars.map(b => b.i.id));
  return bars.flatMap(b => b.i.blocked_by.filter(x => x !== b.i.id && on.has(x)).map(x => [b.i.id, x] as [string, string]));
}

/** criticalPath is the chain of drawn, unclosed bars linked by blocks with the longest summed duration, earliest first; [] without links. */
export function criticalPath(bars: Bar[]): string[] {
  const by = new Map(bars.map(b => [b.i.id, b]));
  const es = edges(bars).filter(([a, b]) => eff(by.get(a)!.i) !== "closed" && eff(by.get(b)!.i) !== "closed");
  if (!es.length) return [];
  const waitsOn = new Map<string, string[]>();
  for (const [a, b] of es) waitsOn.set(a, [...(waitsOn.get(a) || []), b]);
  const memo = new Map<string, { len: number; path: string[] }>(), seen = new Set<string>();
  const best = (id: string): { len: number; path: string[] } => {
    const m = memo.get(id); if (m) return m;
    if (seen.has(id)) return { len: 0, path: [] }; // a cycle stops here
    seen.add(id);
    const b = by.get(id)!;
    let tail = { len: 0, path: [] as string[] };
    for (const p of waitsOn.get(id) || []) { const t = best(p); if (t.len > tail.len || !tail.path.length) tail = t; }
    const r = { len: b.end - b.start + tail.len, path: [...tail.path, id] };
    memo.set(id, r); return r;
  };
  let top = { len: -1, path: [] as string[] };
  for (const id of new Set(es.flat())) { const r = best(id); if (r.len > top.len) top = r; }
  return top.path.length > 1 ? top.path : [];
}

/** initials and a hue from the name, so a person keeps one badge everywhere */
export function badge(name: string): { initials: string; hue: number } {
  const words = name.replace(/^.*\//, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
  let h = 0x811c9dc5; for (const c of name) { h ^= c.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return { initials, hue: h % 360 };
}
const badgeHTML = (name: string) => {
  if (!name) return `<span class="tlav none" aria-hidden="true">?</span>`;
  const b = badge(name);
  return `<span class="tlav" aria-hidden="true">${esc(b.initials)}</span>`;
};

let win: WindowKey = store.get<WindowKey>("timelineWindow", "fit");
if (!WINDOWS.some(w => w.key === win)) win = "fit";
export const setTimelineWindow = (k: string) => { if (WINDOWS.some(w => w.key === k)) { win = k as WindowKey; store.set("timelineWindow", k); } };

const ROW = 26;
let drawn: { edges: [string, string][]; crit: string[] } = { edges: [], crit: [] };

export function renderTimeline(): void {
  const v = $("#vTimeline"), now = Date.now();
  const items = pool().filter(textMatches);
  const w = win === "fit" ? fitWindow(items, now) : WINDOWS.find(x => x.key === win)!;
  const lanes = layout(items, now, w.past, w.ahead, D.project.all);
  const bars = lanes.flatMap(l => l.bars), critPath = criticalPath(bars), crit = new Set(critPath), full = w.past + w.ahead, from = now - w.past;
  const pct = (x: number) => (x * 100).toFixed(3) + "%";
  const steps = [H, 2 * H, 6 * H, 12 * H, DAY, 2 * DAY, 7 * DAY, 14 * DAY];
  const every = steps.find(s => full / s <= 10) || 30 * DAY;
  const ticks: number[] = []; for (let t = Math.ceil(from / every) * every; t <= from + full; t += every) ticks.push(t);
  const lab = (t: number) => new Date(t).toLocaleString(undefined, every < DAY ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short" });
  const grid = ticks.map(t => `<div class="tltick" style="left:${pct((t - from) / full)}"></div>`).join("") + (w.past <= full ? `<div class="tlnow" style="left:${pct(w.past / full)}"></div>` : "");
  const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const bar = (b: Bar, row: number) => {
    const st = stOf(eff(b.i)), right = b.x0 > 0.62;
    const label = `${shortId(b.i.id)} ${b.i.t}, ${b.i.assignee || "unassigned"}, ${b.planned ? "planned" : st.w}${crit.has(b.i.id) ? ", critical path" : ""}, ${b.approx ? "about " : ""}${when(b.start)} to ${b.live ? "now" : when(b.end)}`;
    // The button reaches from the bar to the track's far edge (or, near the right, from the near edge to the bar), so the label
    // always has room; the fill inside is the bar itself, at least 6 px wide so a ten-minute item still shows.
    const place = right ? `left:0;width:${pct(b.x1)}` : `left:${pct(b.x0)};width:${pct(1 - b.x0)}`;
    const fw = right ? (b.x1 - b.x0) / Math.max(b.x1, 1e-6) : (b.x1 - b.x0) / Math.max(1 - b.x0, 1e-6);
    return `<button class="tlbar${right ? " rt" : ""}${b.planned ? " planned" : ""}${b.approx ? " approx" : ""}${crit.has(b.i.id) ? " crit" : ""}" data-open="${esc(b.i.id)}" data-tl="${esc(b.i.id)}" title="${esc(label)}" aria-label="${esc(label)}"`
      + ` style="${place};top:${4 + row * ROW}px;--c:${st.c}"><i class="tlfill" style="width:${pct(Math.min(1, fw))}"></i>${badgeHTML(b.i.assignee)}<span class="st" style="color:var(--c)" aria-hidden="true">${st.g}</span><span class="t">${esc(b.i.t)}</span></button>`;
  };
  const head = `<div class="tlhead"><span class="tlwins" role="group" aria-label="Window">${WINDOWS.map(x => `<button class="chip${x.key === win ? " on" : ""}" data-tlwin="${x.key}" aria-pressed="${x.key === win}">${x.key}</button>`).join("")}</span>`
    + `<span class="tlkey"><span><i class="tlk" style="--c:var(--cyan)"></i>in progress</span><span><i class="tlk" style="--c:var(--muted)"></i>closed</span><span><i class="tlk planned"></i>planned</span><span><i class="tlk crit"></i>critical path</span><span>hover a bar: → waits on</span></span></div>`;
  if (!lanes.length) { v.innerHTML = head + `<div class="empty">Nothing started, closed or planned in this window. Planned work needs a due date.</div>`; return; }
  v.innerHTML = head + `<div class="scroll tlscroll"><div class="tlgrid"><div class="tllane tlaxis"><div class="tlwho"></div><div class="tltrack">${ticks.map(t => `<span style="left:${pct((t - from) / full)}">${esc(lab(t))}</span>`).join("")}</div></div>`
    + lanes.map((l, n) => (l.group !== lanes[n - 1]?.group ? `<div class="sec tlgroup">${esc(l.group)}</div>` : "")
      + `<div class="tllane"><div class="tlwho">${badgeHTML(l.owner)}<span>${esc(l.owner || "unassigned")}</span></div><div class="tltrack" style="height:${l.bars.length * ROW + 8}px">${grid}${l.bars.map(bar).join("")}</div></div>`).join("")
    + `</div></div>`;
  drawn = { edges: edges(bars), crit: critPath };
  const open = S.detail?.stack[S.detail.stack.length - 1];
  drawArrows(v, open);
  if (!v.dataset.tlHover) {
    v.dataset.tlHover = "1";
    const on = (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tl]"); drawArrows(v, b?.dataset.tl || S.detail?.stack[S.detail.stack.length - 1]); };
    v.addEventListener("mouseover", on); v.addEventListener("focusin", on);
  }
}

/** shownEdges are the critical path's links plus every link that touches focus. */
export function shownEdges(all: [string, string][], crit: string[], focus?: string): [string, string][] {
  const onPath = new Set(crit.slice(1).map((id, k) => id + "\u0000" + crit[k]));
  return all.filter(([a, b]) => a === focus || b === focus || onPath.has(a + "\u0000" + b));
}

/** one SVG over the grid, measured off the drawn fills: from the end of the issue waited on to the start of the waiter */
function drawArrows(v: HTMLElement, focus?: string): void {
  const grid = v.querySelector<HTMLElement>(".tlgrid");
  if (!grid) return;
  grid.querySelector(".tlarrows")?.remove();
  const es = shownEdges(drawn.edges, drawn.crit, focus);
  if (!es.length) return;
  const g = grid.getBoundingClientRect();
  const at = (id: string) => grid.querySelector<HTMLElement>(`[data-tl="${CSS.escape(id)}"] .tlfill`)?.getBoundingClientRect();
  const paths = es.flatMap(([waiter, on]) => {
    const a = at(on), b = at(waiter); if (!a || !b) return [];
    const x1 = a.right - g.left, y1 = a.top + a.height / 2 - g.top, x2 = b.left - g.left, y2 = b.top + b.height / 2 - g.top, mx = Math.max(x1 + 8, (x1 + x2) / 2);
    const hot = waiter === focus || on === focus;
    return [`<path class="${hot ? "hot" : "cp"}" d="M${x1},${y1} C${mx},${y1} ${Math.min(mx, x2 - 8)},${y2} ${x2},${y2}" marker-end="url(#tlah)"/>`];
  });
  grid.insertAdjacentHTML("beforeend", `<svg class="tlarrows" width="${g.width}" height="${g.height}" aria-hidden="true"><defs><marker id="tlah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L8,4L0,8z"/></marker></defs>${paths.join("")}</svg>`);
}
