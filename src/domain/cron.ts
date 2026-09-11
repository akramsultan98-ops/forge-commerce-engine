// Minimal, dependency-free 5-field cron parser (minute hour day-of-month month day-of-week), evaluated in UTC.
// Supports: *, */n, a-b, a-b/n, lists (a,b,c), and names for months/weekdays (JAN, MON…).

type Field = { values: Set<number>; wildcard: boolean };
export type CronSpec = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function parseField(src: string, min: number, max: number, names?: string[], nameOffset = 0): Field {
  const values = new Set<number>();
  const toNum = (tok: string) => {
    const upper = tok.toUpperCase();
    if (names) {
      const idx = names.indexOf(upper);
      if (idx >= 0) return idx + nameOffset;
    }
    if (!/^\d+$/.test(tok)) throw new Error(`Invalid cron token "${tok}"`);
    return Number(tok);
  };
  for (const part of src.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step in "${part}"`);
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = toNum(a);
      hi = toNum(b);
    } else {
      lo = toNum(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron value out of range in "${part}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, wildcard: src === "*" };
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields, got ${parts.length}: "${expr}"`);
  const dow = parseField(parts[4], 0, 7, DAYS);
  if (dow.values.has(7)) {
    dow.values.delete(7);
    dow.values.add(0);
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12, MONTHS, 1),
    dow,
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const domOk = spec.dom.values.has(d.getUTCDate());
  const dowOk = spec.dow.values.has(d.getUTCDay());
  // Standard cron semantics: if both fields are restricted, either may match.
  if (!spec.dom.wildcard && !spec.dow.wildcard) return domOk || dowOk;
  if (!spec.dom.wildcard) return domOk;
  if (!spec.dow.wildcard) return dowOk;
  return true;
}

/** Next fire time strictly after `from` (UTC). Throws if nothing matches within ~5 years. */
export function nextCronDate(expr: string | CronSpec, from: Date = new Date()): Date {
  const spec = typeof expr === "string" ? parseCron(expr) : expr;
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 86400_000;
  while (d.getTime() <= limit) {
    if (!spec.month.values.has(d.getUTCMonth() + 1)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, d)) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hour.values.has(d.getUTCHours())) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minute.values.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  throw new Error(`Cron expression never fires: ${typeof expr === "string" ? expr : "<spec>"}`);
}

/** Human-readable summary for the automations UI. */
export function describeCron(expr: string): string {
  const presets: Record<string, string> = {
    "* * * * *": "Every minute",
    "*/5 * * * *": "Every 5 minutes",
    "*/15 * * * *": "Every 15 minutes",
    "0 * * * *": "Hourly",
  };
  if (presets[expr]) return presets[expr];
  const [m, h, dom, mon, dow] = expr.split(/\s+/);
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*") {
    const time = `${h.padStart(2, "0")}:${m.padStart(2, "0")} UTC`;
    if (dow === "*") return `Daily at ${time}`;
    if (/^\d$/.test(dow)) return `Weekly on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(dow) % 7]} at ${time}`;
  }
  return expr;
}
