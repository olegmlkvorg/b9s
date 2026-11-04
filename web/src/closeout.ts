// Beads has one closed status, so why an issue closed is read from its close reason. A reason opening with one of these words
// says the work was not done; every other closed issue is done, an empty reason included.
const REJECTED = ["superseded", "rejected", "dropped", "cancelled", "duplicate", "won't", "wontfix", "not needed", "obsolete"];

export const closedAs = (reason: string | undefined): "done" | "rejected" => {
  const r = (reason || "").trim().toLowerCase().replace(/’/g, "'");
  return REJECTED.some(w => r.startsWith(w)) ? "rejected" : "done";
};
