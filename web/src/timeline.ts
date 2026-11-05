// The timeline view: a Gantt of the project's work. Sections are epics (inside each project when b9s shows all projects), and
// inside a section every issue gets its own row, grouped by assignee, so no two bars overlap. Each bar runs from when work began
// (started_at; else the planned start; else created, marked approximate) to closed, now, or the due date. A never-started issue
// with a due date is planned and drawn outlined. The default window is 3d (a day back, two ahead); "fit" spans the open work. "blocks"
// arrows are drawn for the critical path (the longest open chain) and for the hovered or opened issue only. The tree's text
// query and project filter apply; status chips do not, since closed work belongs on a timeline; archived issues stay out unless the Archived chip is on. A bar opens the detail.
// Inside a lane, items in one state with one subject sit in a group that spans first to last; a tap folds or unfolds it. The subject
// A project with a plan reads as deliverables: one row each, with done of total, its state, the agents as badges and what it waits on; a
// tap opens its items, with the same folds inside, and the "agents" chip gives the owner lanes back. A project with no plan keeps lanes.
// is the group Opus named for the item (the house's bin/timeline-groups.ts, served at api/timeline-groups, which also sets the reading
// order), else the item's parent, else the kind its title opens with. In-progress work never groups. An arrow to a folded item ends on its group.

import { timelineGroups } from "./api";
import { closedAs } from "./closeout";
import { timeText } from "./timetext";
import { D, ancestors, eff, get, pool, projectOf, shortId, type Item } from "./data";
import { S, textMatches } from "./state";
import { $, esc, parseTime, store } from "./util";

const H = 3600e3, DAY = 24 * H;
/** The five states a bar shows, each with a shape and a mark as well as a colour. The legend renders from this table. */
export const STATES = {
  open: { g: "○", w: "open / planned" }, progress: { g: "●", w: "in progress" }, blocked: { g: "⊘", w: "blocked" },
  done: { g: "✓", w: "done" }, rejected: { g: "✕", w: "closed, rejected" },
} as const;
export type BarState = keyof typeof STATES;
/** barState reads an issue's state: closed splits by its close reason, and anything not moving or blocked is open. */
export function barState(i: Item): BarState {
  const s = eff(i);
  return s === "closed" ? closedAs(i.close_reason) : s === "blocked" ? "blocked" : s === "in_progress" ? "progress" : "open";
}
/** past: how far back the window reaches; ahead: how far past now. "fit" is computed from the items (fitWindow). */
export const WINDOWS = [
  { key: "fit", past: 0, ahead: 0 },
  { key: "12h", past: 12 * H, ahead: 2 * H }, { key: "3d", past: DAY, ahead: 2 * DAY },
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

/** fitWindow starts a tenth before the earliest unclosed bar (or now) and ends a tenth after the 90th percentile of their ends,
 * so one far-off due date does not shrink the rest to a sliver; at least FIT_MIN long, at most FIT_MAX, keeping the start. */
export function fitWindow(items: Item[], now: number): { past: number; ahead: number } {
  let lo = now; const ends: number[] = [now];
  for (const i of items) {
    if (eff(i) === "closed") continue;
    const s = span(i, now); if (!s) continue;
    lo = Math.min(lo, s.start); ends.push(s.end);
  }
  ends.sort((a, b) => a - b);
  const hi = ends[Math.floor(0.9 * (ends.length - 1))];
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
function placedBars(items: Item[], now: number, from: number, full: number): Bar[] {
  return items.flatMap(i => {
    const s = span(i, now);
    if (!s || s.end < from || s.start > from + full) return [];
    return [{ i, ...s, x0: Math.max(0, (s.start - from) / full), x1: Math.min(1, (s.end - from) / full) }];
  });
}
export function layout(items: Item[], now: number, past: number, ahead: number, byProject: boolean): Lane[] {
  const from = now - past, full = past + ahead, lanes = new Map<string, Bar[]>();
  for (const bar of placedBars(items, now, from, full)) {
    const i = bar.i, e = epicOf(i), ep = e ? get(e) : undefined;
    const group = (byProject ? projectOf(i) + " / " : "") + (ep ? ep.t : "No epic");
    const key = group + "\u0000" + (i.assignee || "");
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push(bar);
  }
  const noEpic = (g: string) => g.endsWith("No epic") ? 1 : 0;
  return [...lanes].map(([key, bars]) => {
    const [group, owner] = key.split("\u0000");
    return { group, owner, bars: bars.sort((a, c) => a.start - c.start) };
  }).sort((a, b) => noEpic(a.group) - noEpic(b.group) || a.group.localeCompare(b.group) || (a.owner ? 0 : 1) - (b.owner ? 0 : 1)
    || Number(b.bars.some(x => x.live)) - Number(a.bars.some(x => x.live)) || a.owner.localeCompare(b.owner));
}

/** Words a title opens with that name a kind of work, and how a group of them reads. */
const KINDS: Record<string, string> = { fix: "fixes", ruling: "rulings", look: "looks", qa: "QA checks", review: "reviews", bug: "bugs", slice: "slices", wait: "waits", build: "builds" };
/** subjectOf is what an item is grouped by: its parent, else the kind its title opens with, else "other work". */
export function subjectOf(i: Item): string {
  const p = i.parent ? get(i.parent) : undefined;
  return p ? p.t : KINDS[(i.t.match(/^[a-z]+/i)?.[0] || "").toLowerCase()] || "other work";
}

/** One item's place in a named plan: its group, why, and where that group comes in the project's reading order. */
export interface Placed { name: string; reason: string; rank: number }
export interface Group { key: string; state: BarState; subject: string; reason?: string; bars: Bar[]; start: number; end: number; x0: number; x1: number; approx: boolean }
export type Row = { bar: Bar } | { group: Group };
const GROUP_MIN = 2;
/** Done and rejected start folded; blocked and open keep their rows in view until tapped. */
export const foldedAtFirst = (s: BarState) => s === "done" || s === "rejected";

/** rowsOf folds a lane: each group takes the place of its earliest item, with its items after it when open. */
export function rowsOf(l: Lane, isOpen: (g: Group) => boolean, placed: (id: string) => Placed | undefined = () => undefined): Row[] {
  const subject = (i: Item) => placed(i.id)?.name || subjectOf(i), rank = (b: Bar) => placed(b.i.id)?.rank ?? Infinity;
  const ordered = [...l.bars].sort((a, b) => rank(a) === rank(b) ? 0 : rank(a) - rank(b));
  const groups = new Map<string, Bar[]>();
  for (const b of ordered) {
    const state = barState(b.i);
    if (state === "progress") continue;
    const key = ["g", l.group, l.owner, state, subject(b.i)].join("|");
    groups.set(key, [...(groups.get(key) || []), b]);
  }
  const of = new Map<Bar, Group>();
  for (const [key, bars] of groups) {
    if (bars.length < GROUP_MIN) continue;
    const g: Group = { key, state: barState(bars[0].i), subject: subject(bars[0].i), reason: placed(bars[0].i.id)?.reason, bars, start: Math.min(...bars.map(b => b.start)), end: Math.max(...bars.map(b => b.end)), x0: Math.min(...bars.map(b => b.x0)), x1: Math.max(...bars.map(b => b.x1)), approx: bars.some(b => b.approx) };
    for (const b of bars) of.set(b, g);
  }
  return ordered.flatMap((bar): Row[] => {
    const g = of.get(bar);
    if (!g) return [{ bar }];
    if (g.bars[0] !== bar) return [];
    return [{ group: g }, ...(isOpen(g) ? g.bars.map(b => ({ bar: b })) : [])];
  });
}

/** foldEdges moves each link's ends onto the folded groups in rep; a link inside one group disappears, and a repeat is kept once. */
export function foldEdges(es: [string, string][], rep: Map<string, string>): [string, string][] {
  const seen = new Set<string>();
  return es.flatMap(([a, b]): [string, string][] => {
    const x = rep.get(a) || a, y = rep.get(b) || b, k = x + "\u0000" + y;
    if (x === y || seen.has(k)) return [];
    seen.add(k); return [[x, y]];
  });
}
/** foldPath moves the critical path onto groups, so a stretch inside one folded group is one step. */
export function foldPath(path: string[], rep: Map<string, string>): string[] {
  return path.map(id => rep.get(id) || id).filter((id, k, all) => id !== all[k - 1]);
}

export interface Plan { project: string; groups: { name: string; reason: string; ids: string[] }[] }
export interface Deliverable { key: string; name: string; reason: string; project: string; bars: Bar[]; done: number; total: number; state: BarState; blocked: number; owners: string[]; waits: string[]; start: number; end: number; x0: number; x1: number; approx: boolean }
const UNPLACED = { name: "Not placed yet", reason: "New items no deliverable has taken yet." };

/** deliverables turns plans into rows, in plan order. Progress counts every item, in the window or not; rejected work is out of the total. One finished before the window is left out. */
export function deliverables(plans: Plan[], items: Item[], now: number, past: number, ahead: number): Deliverable[] {
  const from = now - past, full = past + ahead, placed = new Set(plans.flatMap(p => p.groups.flatMap(g => g.ids)));
  return plans.flatMap(p => [...p.groups, { ...UNPLACED, ids: items.filter(i => i.id.startsWith(p.project + "-") && !placed.has(i.id)).map(i => i.id) }].flatMap((g): Deliverable[] => {
    const inside = g.ids.flatMap(id => { const i = get(id); return i && items.includes(i) ? [i] : []; });
    if (!inside.length) return [];
    const states = inside.map(barState), count = (s: BarState) => states.filter(x => x === s).length;
    const spans = inside.flatMap(i => { const s = span(i, now); return s ? [s] : []; });
    const start = spans.length ? Math.min(...spans.map(s => s.start)) : now, end = spans.length ? Math.max(...spans.map(s => s.end)) : now;
    const total = inside.length - count("rejected"), done = count("done");
    const state: BarState = count("progress") ? "progress" : count("blocked") ? "blocked" : total === 0 ? "rejected" : done === total ? "done" : "open";
    if ((state === "done" || state === "rejected") && end < from) return [];
    const ids = new Set(g.ids), clip = (t: number) => Math.min(1, Math.max(0, (t - from) / full));
    const waits = [...new Set(inside.filter(i => barState(i) === "blocked").flatMap(i => i.blocked_by))].filter(x => { const o = get(x); return !ids.has(x) && !(o && eff(o) === "closed"); });
    return [{ key: ["d", p.project, g.name].join("|"), name: g.name, reason: g.reason, project: p.project, bars: placedBars(inside, now, from, full).sort((a, c) => a.start - c.start), done, total, state, blocked: count("blocked"),
      owners: [...new Set(inside.filter(i => eff(i) !== "closed").concat(inside).map(i => i.assignee).filter(Boolean) as string[])], waits, start, end, x0: clip(start), x1: clip(end), approx: spans.some(s => s.approx) }];
  }));
}

/** edges are [waiter, waited-on] for every blocks relation whose two ends are drawn. */
export function edges(bars: Bar[]): [string, string][] {
  const on = new Set(bars.map(b => b.i.id));
  return bars.flatMap(b => b.i.blocked_by.filter(x => x !== b.i.id && on.has(x)).map(x => [b.i.id, x] as [string, string]));
}

/** waitsOffView lists what an issue still waits on that has no bar here (out of the window or filtered out), so no arrow can reach it. */
export function waitsOffView(i: Item, on: Set<string>): string[] {
  return i.blocked_by.filter(x => { const b = get(x); return x !== i.id && !on.has(x) && !(b && eff(b) === "closed"); });
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

// 3d (a day back, two ahead) is the default so today's work reads on first open; a picked chip is remembered.
let win: WindowKey = store.get<WindowKey>("timelineWindow", "3d");
if (!WINDOWS.some(w => w.key === win)) win = "3d";
/** A tapped group's state, by key; a group never tapped follows foldedAtFirst. */
let tapped = store.get<Record<string, boolean>>("timelineGroups", {});
const groupOpen = (g: Group) => tapped[g.key] ?? !foldedAtFirst(g.state);
const deliverableOpen = (d: Deliverable) => tapped[d.key] ?? false;
export const toggleTimelineGroup = (key: string, opened: boolean) => { tapped = { ...tapped, [key]: !opened }; store.set("timelineGroups", tapped); };
/** The named plans by item, refetched at most once a minute; none or a failed read leaves the program's grouping. */
let placedBy = new Map<string, Placed>(), plansAt = 0, plans: Plan[] = [];
let byAgent = store.get<boolean>("timelineByAgent", false);
export const toggleTimelineAgents = () => { byAgent = !byAgent; store.set("timelineByAgent", byAgent); };
function refreshPlans(): void {
  if (Date.now() - plansAt < 60e3) return;
  plansAt = Date.now();
  timelineGroups().then(r => {
    plans = r.plans;
    placedBy = new Map(r.plans.flatMap(p => p.groups.flatMap((g, rank) => g.ids.map(id => [id, { name: g.name, reason: g.reason, rank }] as [string, Placed]))));
    if (placedBy.size) renderTimeline();
  }, () => { /* the program's grouping stands */ });
}
export const setTimelineWindow = (k: string) => { if (WINDOWS.some(w => w.key === k)) { win = k as WindowKey; store.set("timelineWindow", k); } };

const ROW = 26;
let drawn: { edges: [string, string][]; crit: string[]; off: Map<string, string[]>; rep: Map<string, string> } = { edges: [], crit: [], off: new Map(), rep: new Map() };
let revealed: string | undefined;

export function renderTimeline(): void {
  refreshPlans();
  const v = $("#vTimeline"), now = Date.now();
  const items = pool().filter(textMatches);
  const w = win === "fit" ? fitWindow(items, now) : WINDOWS.find(x => x.key === win)!;
  const dPlans = byAgent ? [] : plans, ds = deliverables(dPlans, items, now, w.past, w.ahead), inPlan = (i: Item) => dPlans.some(p => i.id.startsWith(p.project + "-"));
  const lanes = layout(items.filter(i => !inPlan(i)), now, w.past, w.ahead, D.project.all);
  const bars = [...ds.flatMap(d => d.bars), ...lanes.flatMap(l => l.bars)], critPath = criticalPath(bars), crit = new Set(critPath), full = w.past + w.ahead, from = now - w.past;
  const onView = new Set(bars.map(b => b.i.id)), off = new Map(bars.map(b => [b.i.id, waitsOffView(b.i, onView)]));
  // A text search is looking for items, so it shows every row.
  const rows = lanes.map(l => rowsOf(l, g => !!S.text.trim() || groupOpen(g), id => placedBy.get(id)));
  // A deliverable's items fold the same way, with no owner: each item shows its own badge.
  const dRows = ds.map(d => !!S.text.trim() || deliverableOpen(d) ? rowsOf({ group: d.key, owner: "", bars: d.bars }, g => !!S.text.trim() || groupOpen(g)) : []);
  const rep = new Map<string, string>(), shownBars = new Set([...rows, ...dRows].flat().flatMap(r => "bar" in r ? [r.bar.i.id] : []));
  ds.forEach((d, n) => {
    if (dRows[n].length) return;
    for (const b of d.bars) rep.set(b.i.id, d.key);
    off.set(d.key, [...new Set(d.bars.flatMap(b => off.get(b.i.id) || []))]);
  });
  for (const r of [...rows, ...dRows].flat()) if ("group" in r) {
    const g = r.group;
    for (const b of g.bars) if (!shownBars.has(b.i.id)) rep.set(b.i.id, g.key);
    if (rep.has(g.bars[0].i.id)) off.set(g.key, [...new Set(g.bars.flatMap(b => off.get(b.i.id) || []))]);
  }
  const waitText = (b: Bar) => barState(b.i) === "blocked" && !b.i.blocked_by.length ? "\nmarked blocked, no item named as the cause"
    : (off.get(b.i.id) || []).map(x => `\nwaits on ${shortId(x)} ${get(x)?.t || ""} (outside this view)`).join("");
  const pct = (x: number) => (x * 100).toFixed(3) + "%";
  const steps = [H, 2 * H, 6 * H, 12 * H, DAY, 2 * DAY, 7 * DAY, 14 * DAY];
  const every = steps.find(s => full / s <= (innerWidth < 600 ? 5 : 10)) || 30 * DAY; // a phone grid is 600 px wide: half the ticks
  const ticks: number[] = []; for (let t = Math.ceil(from / every) * every; t <= from + full; t += every) ticks.push(t);
  const lab = (t: number) => new Date(t).toLocaleString(undefined, every < DAY ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short" });
  const grid = ticks.map(t => `<div class="tltick" style="left:${pct((t - from) / full)}"></div>`).join("") + (w.past <= full ? `<div class="tlnow" style="left:${pct(w.past / full)}"></div>` : "");
  const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const bar = (b: Bar, row: number) => {
    const state = barState(b.i), word = b.planned && state === "open" ? "planned" : STATES[state].w;
    const label = `${shortId(b.i.id)} ${b.i.t}, ${b.i.assignee || "unassigned"}, ${word}${state === "rejected" && b.i.close_reason ? ` (${b.i.close_reason})` : ""}${crit.has(b.i.id) ? ", critical path" : ""}, ${b.approx ? "about " : ""}${when(b.start)} to ${b.live ? "now" : when(b.end)}`;
    return shell(b, row, state, `${b.live ? " live" : ""}${b.planned ? " planned" : ""}${crit.has(b.i.id) ? " crit" : ""}`, `data-open="${esc(b.i.id)}" data-tl="${esc(b.i.id)}"`,
      `${b.i.t}\n${timeText(b.start, b.live ? now : b.end, b.live, b.approx)}${waitText(b)}`, label, b.i.assignee, STATES[state].g, b.i.t);
  };
  // The button reaches from the bar to the track's far edge (or, near the right, from the near edge to the bar), so the label
  // always has room; the fill inside is the bar itself, at least 6 px wide so a ten-minute item still shows.
  const shell = (b: { x0: number; x1: number; approx: boolean }, row: number, state: BarState, cls: string, attrs: string, title: string, label: string, who: string | undefined | null | string[], mark: string, text: string) => {
    const right = b.x0 > 0.62, place = right ? `left:0;width:${pct(b.x1)}` : `left:${pct(b.x0)};width:${pct(1 - b.x0)}`;
    const fw = right ? (b.x1 - b.x0) / Math.max(b.x1, 1e-6) : (b.x1 - b.x0) / Math.max(1 - b.x0, 1e-6);
    // The label starts past a short fill, so the fill's pattern stays visible; on a long fill it starts at the bar, so it stays in view on a phone.
    const room = right ? b.x1 : 1 - b.x0, lead = b.x1 - b.x0 < room / 2 ? b.x1 - b.x0 : 0, nowAt = Math.min(1, Math.max(0, (w.past / full - b.x0) / Math.max(b.x1 - b.x0, 1e-6)));
    return `<button class="tlbar s-${state}${right ? " rt" : ""}${b.approx ? " approx" : ""}${cls}" ${attrs} title="${esc(title)}" aria-label="${esc(label)}"`
      + ` style="${place};top:${4 + row * ROW}px;--lead:${pct(lead)};--now:${pct(nowAt)}"><i class="tlfill" style="width:${pct(Math.min(1, fw))}"></i>${who === null ? "" : Array.isArray(who) ? badges(who) : badgeHTML(who || "")}<span class="tllab"><span class="tlmk" aria-hidden="true">${mark}</span><span class="t">${esc(text)}</span></span></button>`;
  };
  const groupBar = (g: Group, row: number, owner: string) => {
    const opened = !rep.has(g.bars[0].i.id), word = g.state;
    const inside = new Set(g.bars.map(b => b.i.id));
    const waits = g.state !== "blocked" ? [] : [...new Set(g.bars.flatMap(b => b.i.blocked_by))].filter(x => { const o = get(x); return !inside.has(x) && !(o && eff(o) === "closed"); });
    const first = waits[0] ? get(waits[0])?.t || shortId(waits[0]) : "", text = `${g.bars.length} ${word}: ${g.subject}${first ? `, waits on ${first}${waits.length > 1 ? ` +${waits.length - 1}` : ""}` : ""}`;
    const onCrit = g.bars.some(b => crit.has(b.i.id));
    const who = [...new Set(g.bars.map(b => b.i.assignee))];
    return shell(g, row, g.state, ` grp${onCrit ? " crit" : ""}`, `data-tl="${esc(g.key)}" data-tlgroup="${esc(g.key)}" data-tlopened="${opened}" aria-expanded="${opened}"`,
      `${text}${g.reason ? `\n${g.reason}` : ""}\n${timeText(g.start, g.end, false, g.approx)}${waits.slice(1).map(x => `\nwaits on ${get(x)?.t || shortId(x)}`).join("")}\nTap to ${opened ? "fold" : "show the items"}`,
      `${text}, ${owner || "unassigned"}, ${g.approx ? "about " : ""}${when(g.start)} to ${when(g.end)}${onCrit ? ", critical path" : ""}`, owner || (who.length === 1 ? who[0] : null), opened ? "▾" : "▸", `${STATES[g.state].g} ${text}`);
  };
  const badges = (who: string[]) => who.slice(0, 3).map(badgeHTML).join("") + (who.length > 3 ? `<span class="tlmore">+${who.length - 3}</span>` : "");
  const DWORD: Record<BarState, string> = { progress: "moving", blocked: "stuck", done: "done", open: "next", rejected: "dropped" };
  const deliverableBar = (d: Deliverable, row: number) => {
    const opened = !rep.has(d.bars[0]?.i.id) && (!!S.text.trim() || deliverableOpen(d)), first = d.waits[0] ? get(d.waits[0])?.t || shortId(d.waits[0]) : "";
    const stuck = d.blocked ? `${d.blocked} blocked${first ? `, waits on ${first}${d.waits.length > 1 ? ` +${d.waits.length - 1}` : ""}` : ""}` : "";
    const text = `${d.name}${stuck ? ` · ${stuck}` : ""}`, onCrit = d.bars.some(b => crit.has(b.i.id));
    return shell(d, row, d.state, ` grp dl${onCrit ? " crit" : ""}`, `data-tl="${esc(d.key)}" data-tlgroup="${esc(d.key)}" data-tlopened="${opened}" aria-expanded="${opened}"`,
      `${d.name}: ${d.reason}\n${d.done} of ${d.total} done, ${DWORD[d.state]}\n${d.owners.join(", ") || "nobody assigned"}${stuck ? `\n${stuck}` : ""}${d.waits.slice(1).map(x => `\nwaits on ${get(x)?.t || shortId(x)}`).join("")}`,
      `${d.name}, ${d.done} of ${d.total} done, ${DWORD[d.state]}${stuck ? `, ${stuck}` : ""}, ${d.owners.join(", ") || "nobody assigned"}${onCrit ? ", critical path" : ""}`, d.owners, `${opened ? "▾" : "▸"} ${STATES[d.state].g}`, text);
  };
  const deliverableRow = (d: Deliverable, n: number) => {
    const inner = dRows[n], pct100 = d.total ? Math.round(100 * d.done / d.total) : 0;
    return (d.project !== ds[n - 1]?.project && dPlans.length > 1 ? `<div class="sec tlgroup">${esc(d.project)}</div>` : "")
      + `<div class="tllane"><div class="tlwho tlprog" title="${d.done} of ${d.total} done"><span class="tlpn">${d.done}/${d.total}</span><span class="tlmeter"><i style="width:${pct100}%"></i></span></div><div class="tltrack" style="height:${(inner.length + 1) * ROW + 8}px">${grid}${deliverableBar(d, 0)}${inner.map((r, k) => "bar" in r ? bar(r.bar, k + 1) : groupBar(r.group, k + 1, "")).join("")}</div></div>`;
  };
  const head = `<div class="tlhead"><span class="tlwins" role="group" aria-label="Window">${WINDOWS.map(x => `<button class="chip${x.key === win ? " on" : ""}" data-tlwin="${x.key}" aria-pressed="${x.key === win}">${x.key}</button>`).join("")}${plans.length ? `<button class="chip${byAgent ? " on" : ""}" data-tlagents aria-pressed="${byAgent}">agents</button>` : ""}</span>`
    + `<span class="tlkey">${(Object.keys(STATES) as BarState[]).map(s => `<span class="s-${s}" data-tlstate="${s}"><i class="tlfill"></i><span class="tlmk" aria-hidden="true">${STATES[s].g}</span>${STATES[s].w}</span>`).join("")}<span><i class="tlk crit"></i>critical path</span><span>hover or open a bar: → waits on, ⇢ waits on something outside this view</span><span>tap ▸ to show a group's items</span></span></div>`;
  if (!lanes.length && !ds.length) { v.innerHTML = head + `<div class="empty">Nothing started, closed or planned in this window. Planned work needs a due date.</div>`; return; }
  v.innerHTML = head + `<div class="scroll tlscroll"><div class="tlgrid"><div class="tllane tlaxis"><div class="tlwho"></div><div class="tltrack">${ticks.map(t => `<span style="left:${pct((t - from) / full)}">${esc(lab(t))}</span>`).join("")}</div></div>`
    + ds.map(deliverableRow).join("") + lanes.map((l, n) => (l.group !== lanes[n - 1]?.group ? `<div class="sec tlgroup">${esc(l.group)}</div>` : "")
      + `<div class="tllane"><div class="tlwho">${badgeHTML(l.owner)}<span>${esc(l.owner || "unassigned")}</span></div><div class="tltrack" style="height:${rows[n].length * ROW + 8}px">${grid}${rows[n].map((r, k) => "bar" in r ? bar(r.bar, k) : groupBar(r.group, k, l.owner)).join("")}</div></div>`).join("")
    + `</div></div>`;
  drawn = { edges: foldEdges(edges(bars), rep), crit: foldPath(critPath, rep), off, rep };
  const open = S.detail?.stack[S.detail.stack.length - 1];
  drawArrows(v, open);
  if (!v.dataset.tlHover) {
    v.dataset.tlHover = "1";
    const on = (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tl]"); drawArrows(v, b?.dataset.tl || S.detail?.stack[S.detail.stack.length - 1]); };
    v.addEventListener("mouseover", on); v.addEventListener("focusin", on);
  }
}

/** After opening an issue, bring its label out from under the sticky owner column or past the far edge. Runs once per opened issue, so it never fights a swipe. */
export function revealOpenBar(): void {
  const id = S.detail?.stack[S.detail.stack.length - 1];
  if (id === revealed) return;
  revealed = id;
  const v = $("#vTimeline"), box = v.querySelector<HTMLElement>(".tlscroll");
  const label = id && box?.querySelector<HTMLElement>(`[data-tl="${CSS.escape(id)}"] .tllab`);
  if (!box || !label) return;
  const r = label.getBoundingClientRect(), b = box.getBoundingClientRect(), near = b.left + (box.querySelector<HTMLElement>(".tlwho")?.offsetWidth || 0) + 4;
  if (r.left < near) box.scrollLeft -= near - r.left;
  else if (r.right > b.right) box.scrollLeft += Math.min(r.right - b.right, r.left - near);
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
  focus = focus && (drawn.rep.get(focus) || focus);
  const es = shownEdges(drawn.edges, drawn.crit, focus), stub = focus && drawn.off.get(focus)?.length ? focus : "";
  if (!es.length && !stub) return;
  const g = grid.getBoundingClientRect();
  const at = (id: string) => grid.querySelector<HTMLElement>(`[data-tl="${CSS.escape(id)}"] .tlfill`)?.getBoundingClientRect();
  const paths = es.flatMap(([waiter, on]) => {
    const a = at(on), b = at(waiter); if (!a || !b) return [];
    const x1 = a.right - g.left, y1 = a.top + a.height / 2 - g.top, x2 = b.left - g.left, y2 = b.top + b.height / 2 - g.top, mx = Math.max(x1 + 8, (x1 + x2) / 2);
    const hot = waiter === focus || on === focus;
    return [`<path class="${hot ? "hot" : "cp"}" d="M${x1},${y1} C${mx},${y1} ${Math.min(mx, x2 - 8)},${y2} ${x2},${y2}" marker-end="url(#tlah)"/>`];
  });
  // What the focused bar waits on has no bar here: a short dashed arrow into its start, kept clear of the sticky owner column.
  const s = stub ? at(stub) : undefined;
  if (s) {
    const track = grid.querySelector(".tltrack")!.getBoundingClientRect().left - g.left, y = s.top + s.height / 2 - g.top;
    const x1 = Math.max(track + 2, s.left - g.left - 26);
    paths.push(`<path class="hot off" data-off="${esc(stub)}" d="M${x1},${y} L${x1 + 26},${y}" marker-end="url(#tlah)"/>`);
  }
  grid.insertAdjacentHTML("beforeend", `<svg class="tlarrows" width="${g.width}" height="${g.height}" aria-hidden="true"><defs><marker id="tlah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L8,4L0,8z"/></marker></defs>${paths.join("")}</svg>`);
}
