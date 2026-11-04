// The time line of a bar's hover title, in the shortest form that is still exact enough: one day shows the clock range and the
// duration, several days show the dates and the duration. Pure, so its table runs without a browser.
const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  return `${Math.round(min / 1440)} d`;
}

/** timeText spans start to end; live ends at "now", and an unmeasured start reads "about". */
export function timeText(start: number, end: number, live: boolean, approx: boolean): string {
  const a = new Date(start), b = new Date(end), pre = approx ? "about " : "", to = live ? "now" : clock(b);
  if (sameDay(a, b)) return pre + (end - start < 60000 && !live ? clock(a) : `${clock(a)}-${to}, ${duration(end - start)}`);
  return `${pre}${date(a)} - ${live ? "now" : date(b)}, ${duration(end - start)}`;
}
