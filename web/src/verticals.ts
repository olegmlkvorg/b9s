// Vertical toggles: one chip per vertical (a repository prefix; inside the house prefix, one per issue
// labelled "vertical" plus "house" for the rest). The chosen set filters pool(), so every view agrees.
// Empty set = all. Precedence at boot: ?v= in the URL, then localStorage b9s.verticals, then all; a
// server --filter is query text and stays in the query bar beside the chips.

import { D, get, isArchived, type Item } from "./data";
import { store } from "./util";

/** the prefix whose issues split by the "vertical" label */
export const HOUSE = "house";
export const VERTICAL_LABEL = "vertical";

/** parseV reads "pg,spc" from ?v=; null when the parameter is absent. */
export function parseV(search: string): string[] | null {
  const raw = new URLSearchParams(search).get("v");
  return raw == null ? null : raw.split(",").map(s => s.trim()).filter(Boolean);
}

/** initialVerticals: the URL wins over storage; neither means all. */
export function initialVerticals(search: string, stored: string[]): string[] {
  return parseV(search) ?? stored;
}

/** V.sel is the chosen set; empty means every vertical shows. */
export const V = { sel: new Set<string>(initialVerticals(typeof location === "undefined" ? "" : location.search, store.get<string[]>("verticals", []))) };

const prefixOf = (id: string): string => { const k = id.indexOf("-"); return k < 0 ? id : id.slice(0, k); };

/** scopes lists the issue's dotted ancestors (house-ikb.3.1 -> house-ikb, house-ikb.3) then its parent chain from the top. */
function scopes(i: Item): string[] {
  const out: string[] = [];
  const parts = i.id.split(".");
  for (let n = 1; n < parts.length; n++) out.push(parts.slice(0, n).join("."));
  const chain: string[] = [];
  let p: string | undefined = i.parent || undefined;
  for (let guard = 0; p && guard < 50; guard++) { chain.unshift(p); p = get(p)?.parent || undefined; }
  return [...out, ...chain];
}

/** verticalOf is the one chip an issue counts under. */
export function verticalOf(i: Item): string {
  const prefix = prefixOf(i.id);
  if (prefix !== HOUSE) return prefix;
  for (const id of [...scopes(i), i.id]) if ((get(id)?.labels || []).includes(VERTICAL_LABEL)) return id;
  return HOUSE;
}

export interface VChip { key: string; label: string; open: number; on: boolean }

/** verticalChips builds the row from the loaded issues, archived work left out. */
export function verticalChips(): VChip[] {
  const open = new Map<string, number>();
  for (const i of D.all.values()) {
    if (isArchived(i)) continue;
    const k = verticalOf(i);
    open.set(k, (open.get(k) || 0) + (i.closed_like ? 0 : 1));
  }
  const label = (k: string) => (D.all.has(k) ? (D.all.get(k)!.t || k) : k === HOUSE ? "house ops" : k);
  return [...open].map(([key, n]) => ({ key, label: label(key), open: n, on: V.sel.has(key) }))
    .sort((a, b) => Number(a.key === HOUSE || D.all.has(a.key)) - Number(b.key === HOUSE || D.all.has(b.key)) || a.key.localeCompare(b.key));
}

/** active is the chosen set limited to chips that exist, so a stale ?v= never hides everything. */
export function activeVerticals(): Set<string> | null {
  if (!V.sel.size) return null;
  const have = new Set(verticalChips().map(c => c.key));
  const a = new Set([...V.sel].filter(k => have.has(k)));
  return a.size ? a : null;
}

/** inVerticals is the filter pool() applies. */
export function inVerticals(i: Item): boolean {
  const a = cache();
  return !a || a.has(verticalOf(i));
}

// activeVerticals walks every issue; pool() asks per issue, so the answer is kept per snapshot and selection.
let memo: { v: number; n: number; sel: string; a: Set<string> | null } | null = null;
function cache(): Set<string> | null {
  const sel = [...V.sel].sort().join(",");
  if (!memo || memo.v !== D.version || memo.n !== D.all.size || memo.sel !== sel) memo = { v: D.version, n: D.all.size, sel, a: activeVerticals() };
  return memo.a;
}

/** hiddenCount is the number of verticals the filter hides. */
export function hiddenCount(): number {
  const a = activeVerticals();
  return a ? verticalChips().filter(c => !a.has(c.key)).length : 0;
}

function save(): void {
  store.set("verticals", [...V.sel]);
  try {
    const u = new URL(location.href);
    if (V.sel.size) u.searchParams.set("v", [...V.sel].join(","));
    else u.searchParams.delete("v");
    history.replaceState(history.state, "", u);
  } catch { /* a URL the page cannot rewrite keeps the storage only */ }
}

/** toggleVertical flips one chip. Turning the last chosen one off returns to all. */
export function toggleVertical(k: string): void {
  const a = activeVerticals();
  // From "all", the first tap picks that vertical alone: the chips read as a selection.
  if (!a) V.sel = new Set([k]);
  else if (a.has(k)) a.delete(k), V.sel = a;
  else V.sel = new Set([...a, k]);
  save();
}

/** soloVertical shows one vertical only; on the only one chosen it returns to all. */
export function soloVertical(k: string): void {
  const a = activeVerticals();
  V.sel = a && a.size === 1 && a.has(k) ? new Set() : new Set([k]);
  save();
}

export function clearVerticals(): void { V.sel = new Set(); save(); }

/**
 * bindVerticals wires the chip row: tap toggles, and a long press, double tap, or shift/alt click shows
 * that vertical alone. It runs before gestures.ts's own click handler (capture phase) so the row is ours.
 */
export function bindVerticals(redraw: () => void): void {
  let timer = 0, fired = false;
  const clear = () => { clearTimeout(timer); timer = 0; };
  const vert = (e: Event) => (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-vert]") || null;
  document.addEventListener("pointerdown", e => {
    const b = vert(e); fired = false;
    if (!b) return;
    timer = window.setTimeout(() => { fired = true; soloVertical(b.dataset.vert!); redraw(); }, 450);
  }, true);
  for (const t of ["pointerup", "pointercancel", "pointerleave", "scroll"]) document.addEventListener(t, clear, true);
  document.addEventListener("pointermove", e => { if (timer && Math.hypot(e.movementX, e.movementY) > 3) clear(); }, true);
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement | null;
    const all = t?.closest("[data-vertall]");
    const b = vert(e);
    if (!b && !all) return;
    e.stopPropagation(); e.preventDefault();
    if (fired) { fired = false; return; }
    if (all) clearVerticals();
    else if (e.shiftKey || e.altKey || e.detail >= 2) soloVertical(b!.dataset.vert!);
    else toggleVertical(b!.dataset.vert!);
    redraw();
  }, true);
}
