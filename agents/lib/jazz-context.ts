// Builds Jarvis's view of the app from jazz2-data.json: today's to-dos, bills due soon, wash day.
// Mirrors the app's own rules (js/skin.js washSchedule/isWashDate, js/budget-bills.js billShare).
// Synced text is untrusted: it's trimmed and capped here and only reaches a model as data.

export interface JazzContext {
  available: boolean;
  today: string;
  todosToday: { text: string; starred: boolean }[];
  overdue: { text: string; due: string }[];
  billsDueSoon: { name: string; amount: number; due: string; autopay: boolean }[];
  washDay: boolean;
  washTomorrow: boolean;
  shoppingNeeds: string[]; // open "need" items, high priority first
  shoppingItems: string[]; // every open item (needs and wants), to match deliveries against
  budgetBills: { name: string; amount: number }[]; // every unpaid bill, to check bill emails against
  goals: { name: string; done: number; total: number }[]; // Jazz 3.0 sections
  weightGoalPct: number | null; // how far from start weight to goal weight
}

const DEFAULT_WASH = { anchor: "2026-07-16", everyDays: 14 }; // same as js/skin.js
const MAX_ROWS = 8;
const clip = (s: unknown, n = 120) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayNum = (iso: string) =>
  Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
export const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);

export function isWashDate(iso: string, routine: any): boolean {
  if (!routine || !Array.isArray(routine.washPm) || routine.washPm.length === 0) return false;
  const w = routine.wash;
  const s =
    w && isIso(w.anchor) && Number.isInteger(w.everyDays) && w.everyDays >= 1 && w.everyDays <= 365 ? w : DEFAULT_WASH;
  const diff = dayNum(iso) - dayNum(s.anchor);
  return ((diff % s.everyDays) + s.everyDays) % s.everyDays === 0;
}

const share = (b: any) => {
  const amt = Number(b.amount) || 0;
  return Math.round(amt * (b.group === "joint" && b.share ? Number(b.share) : 100)) / 100;
};

export function emptyContext(today: string): JazzContext {
  return {
    available: false,
    today,
    todosToday: [],
    overdue: [],
    billsDueSoon: [],
    washDay: false,
    washTomorrow: false,
    shoppingNeeds: [],
    shoppingItems: [],
    budgetBills: [],
    goals: [],
    weightGoalPct: null,
  };
}

// Same rules as js/shopping.js wantKind(): wardrobe items without a kind count as needs
function shoppingNeeds(data: any): string[] {
  const list = Array.isArray(data["wants-content"]) ? data["wants-content"] : [];
  const bought = data["wants-state"] && typeof data["wants-state"] === "object" ? data["wants-state"] : {};
  return list
    .filter((w: any) => w && !bought[w.id] && !w.later)
    .filter((w: any) => w.kind === "need" || (w.kind !== "want" && !!w.wardrobeCat))
    .sort((a: any, b: any) => Number(b.priority === "high") - Number(a.priority === "high"))
    .slice(0, 6)
    .map((w: any) => clip(w.name, 60))
    .filter(Boolean);
}

function shoppingItems(data: any): string[] {
  const list = Array.isArray(data["wants-content"]) ? data["wants-content"] : [];
  const bought = data["wants-state"] && typeof data["wants-state"] === "object" ? data["wants-state"] : {};
  return list
    .filter((w: any) => w && !bought[w.id] && !w.later)
    .slice(0, 40)
    .map((w: any) => clip(w.name, 60))
    .filter(Boolean);
}

// Jazz 3.0 sections in their saved order, with how many items are done
function goals(data: any): JazzContext["goals"] {
  const items = Array.isArray(data["plan3-content"]) ? data["plan3-content"] : [];
  const out: JazzContext["goals"] = [];
  for (const x of items) {
    if (!x || typeof x.cat !== "string") continue;
    const name = clip(x.cat, 40);
    let g = out.find((o) => o.name === name);
    if (!g) out.push((g = { name, done: 0, total: 0 }));
    g.total++;
    if (x.done) g.done++;
  }
  return out.slice(0, 6);
}

// Same math as js/fitness.js weightStatus().pct
function weightGoalPct(data: any): number | null {
  const f = data["fitness-content"];
  const ws = f && Array.isArray(f.weights) ? f.weights.filter((w: any) => typeof w?.lbs === "number") : [];
  if (!ws.length || typeof f.goal !== "number") return null;
  const cur = ws[ws.length - 1].lbs;
  const start = typeof f.start === "number" ? f.start : ws[0].lbs;
  if (start === f.goal) return null;
  return Math.max(0, Math.min(100, Math.round(((cur - start) / (f.goal - start)) * 100)));
}

export function buildJazzContext(raw: string | null, today: string): JazzContext {
  if (!raw) return emptyContext(today);
  let data: any;
  try {
    data = JSON.parse(raw)?.data;
  } catch {
    return emptyContext(today);
  }
  if (!data || typeof data !== "object") return emptyContext(today);
  const todos = Array.isArray(data["todo-content"]) ? data["todo-content"] : [];
  const open = todos.filter((t: any) => t && !t.done && isIso(t.due));
  const todosToday = open
    .filter((t: any) => t.due === today)
    .sort((a: any, b: any) => Number(!!b.starred) - Number(!!a.starred))
    .slice(0, MAX_ROWS)
    .map((t: any) => ({ text: clip(t.text), starred: !!t.starred }));
  const overdue = open
    .filter((t: any) => t.due < today)
    .sort((a: any, b: any) => (a.due < b.due ? -1 : 1))
    .slice(0, MAX_ROWS)
    .map((t: any) => ({ text: clip(t.text), due: t.due }));
  const bills = Array.isArray(data["bills-content"]) ? data["bills-content"] : [];
  const soon = addDays(today, 3);
  const billsDueSoon = bills
    .filter((b: any) => b && !b.done && isIso(b.due) && b.due <= soon)
    .sort((a: any, b: any) => (a.due < b.due ? -1 : 1))
    .slice(0, MAX_ROWS)
    .map((b: any) => ({ name: clip(b.name, 60), amount: share(b), due: b.due, autopay: !!b.autopay }));
  // No saved routine means the app is on its built-in one, which has wash steps on the default schedule
  const routine = data["skin-routine-content"] ?? { washPm: [{}] };
  return {
    available: true,
    today,
    todosToday,
    overdue,
    billsDueSoon,
    washDay: isWashDate(today, routine),
    washTomorrow: isWashDate(addDays(today, 1), routine),
    shoppingNeeds: shoppingNeeds(data),
    shoppingItems: shoppingItems(data),
    budgetBills: bills
      .filter((b: any) => b && !b.done && typeof b.name === "string")
      .slice(0, 30)
      .map((b: any) => ({ name: clip(b.name, 60), amount: share(b) })),
    goals: goals(data),
    weightGoalPct: weightGoalPct(data),
  };
}
