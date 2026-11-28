/**
 * Dates and periods as people say them (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B4 and §2.3).
 *
 * One day, for a voice entry: today, yesterday, kal, parso, day before yesterday, "last Friday",
 * "on the 5th", "5th November", "November 5", "2 days ago", "do din pehle". A day that hasn't
 * come yet this month ("the 25th" on the 10th) means last month's: you can't have spent then.
 *
 * A period, for a question: "by day 15", "till the 15th", "last week", "this month", "last month",
 * "in October", "this year", "this financial year", "last 3 months", "today", "yesterday".
 * Pure: `now` is passed in, so tests pin it.
 */

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = "(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?";
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12);
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const monthIndex = (word: string) => MONTH_NAMES.findIndex((n) => n.startsWith(word.toLowerCase().slice(0, 3)));
const dayIndex = (word: string) => DAYS.findIndex((n) => n.startsWith(word.toLowerCase().slice(0, 3)));
const ordinal = (n: number) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

export interface SpokenDate {
  dateIso: string;
  /** The words that said it, so they can be taken out of the sentence. */
  match: string;
}

function addDays(now: Date, n: number): Date {
  return at(now.getFullYear(), now.getMonth(), now.getDate() + n);
}

/** A day of the month said without a month: this month's, or last month's if it hasn't come yet. */
function dayOfMonth(now: Date, day: number): Date | null {
  if (day < 1 || day > 31) return null;
  let y = now.getFullYear();
  let m = now.getMonth();
  if (day > now.getDate()) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return at(y, m, Math.min(day, lastDay(y, m)));
}

/** A day and month: this year's, or last year's if it's still to come. */
function dayAndMonth(now: Date, day: number, month: number): Date | null {
  if (month < 0 || day < 1 || day > 31) return null;
  let y = now.getFullYear();
  // Compared at noon, as the dates are made: today's own date before noon stays this year.
  if (at(y, month, day) > at(now.getFullYear(), now.getMonth(), now.getDate())) y -= 1;
  return at(y, month, Math.min(day, lastDay(y, month)));
}

/** The one day a voice entry was for, or undefined (today). */
export function readSpokenDate(text: string, now: Date = new Date()): SpokenDate | undefined {
  const t = text.toLowerCase();
  const rules: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
    [/\b(day before yesterday|parso|parson)\b/, () => addDays(now, -2)],
    [/\b(yesterday|kal)\b/, () => addDays(now, -1)],
    [/\b(today|aaj)\b/, () => addDays(now, 0)],
    [/\b(\d{1,2}|a|one|two|three|four|five|six|ek|do|teen|char)\s+(days?|din)\s+(ago|back|pehle|before)\b/, (m) => {
      const words: Record<string, number> = { a: 1, one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, six: 6 };
      const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : words[m[1]];
      return n > 0 && n < 60 ? addDays(now, -n) : null;
    }],
    [/\blast week\b/, () => addDays(now, -7)],
    [new RegExp(`\\b(?:last|on|this past)\\s+${DAY_RE}\\b`), (m) => {
      const want = dayIndex(m[1]);
      if (want < 0) return null;
      let back = (now.getDay() - want + 7) % 7;
      if (back === 0) back = 7;
      return addDays(now, -back);
    }],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`), (m) => dayAndMonth(now, parseInt(m[1], 10), monthIndex(m[2]))],
    [new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`), (m) => dayAndMonth(now, parseInt(m[2], 10), monthIndex(m[1]))],
    // "on the 5th", "the 5th", "on the 5": not "the 2 tickets" or "the 24 seven store".
    [/\b(?:on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?|the\s+(\d{1,2})(?:st|nd|rd|th))\b/, (m) => dayOfMonth(now, parseInt(m[1] ?? m[2], 10))],
    [/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)\b/, (m) => dayOfMonth(now, parseInt(m[1], 10))],
  ];
  for (const [re, make] of rules) {
    const m = t.match(re);
    if (!m) continue;
    const d = make(m);
    if (!d) continue;
    // Never a day still to come.
    if (d > at(now.getFullYear(), now.getMonth(), now.getDate())) continue;
    return { dateIso: iso(d), match: text.substr(m.index ?? 0, m[0].length) };
  }
  return undefined;
}

export interface SpokenPeriod {
  start: string;
  end: string;
  /** How to say it back: "1–15 Nov", "October", "this financial year". */
  label: string;
  /** The same stretch one step earlier, for "against last month": same days of the previous month, last week, last year. */
  previous: { start: string; end: string; label: string };
  match: string;
}

function monthRange(y: number, m: number) {
  return { start: iso(at(y, m, 1)), end: iso(at(y, m, lastDay(y, m))) };
}
function prevMonth(y: number, m: number): [number, number] {
  return m === 0 ? [y - 1, 11] : [y, m - 1];
}
const capped = (d: Date, now: Date) => (d > now ? now : d);

/**
 * The period a question is about, or undefined (the caller picks: usually this month).
 * `fyStartMonth` is 1–12 (4 = April, the Indian financial year).
 */
export function readSpokenPeriod(text: string, now: Date = new Date(), fyStartMonth = 4): SpokenPeriod | undefined {
  const t = text.toLowerCase();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const today = at(y, mo, now.getDate());
  const make = (start: Date, end: Date, label: string, prev: { start: Date; end: Date; label: string }, m: RegExpMatchArray): SpokenPeriod => ({
    start: iso(start),
    end: iso(end),
    label,
    previous: { start: iso(prev.start), end: iso(prev.end), label: prev.label },
    match: text.substr(m.index ?? 0, m[0].length),
  });

  // "by day 15", "till the 15th", "up to 15th", "first 15 days": day 1 to that day, this month
  // (last month if it hasn't come yet), against the same days of the month before.
  let m = t.match(/\b(?:by|till|until|upto|up to|through|to)\s+(?:the\s+)?(?:day\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:days?|rupees?|rs|k\b))/) ?? t.match(/\bfirst\s+(\d{1,2})\s+days\b/);
  if (m) {
    const day = parseInt(m[1], 10);
    if (day >= 1 && day <= 31) {
      let [py, pm] = [y, mo];
      if (day > now.getDate()) [py, pm] = prevMonth(y, mo);
      const end = at(py, pm, Math.min(day, lastDay(py, pm)));
      const [qy, qm] = prevMonth(py, pm);
      const pEnd = at(qy, qm, Math.min(day, lastDay(qy, qm)));
      return make(at(py, pm, 1), end, `1–${end.getDate()} ${SHORT_MONTHS[pm]}`, { start: at(qy, qm, 1), end: pEnd, label: `1–${pEnd.getDate()} ${SHORT_MONTHS[qm]}` }, m);
    }
  }
  if ((m = t.match(/\b(today|aaj)\b/))) {
    const p = addDays(now, -1);
    return make(today, today, "today", { start: p, end: p, label: "yesterday" }, m);
  }
  if ((m = t.match(/\b(day before yesterday)\b/))) {
    const d = addDays(now, -2);
    const p = addDays(now, -3);
    return make(d, d, "the day before yesterday", { start: p, end: p, label: "the day before" }, m);
  }
  if ((m = t.match(/\b(yesterday|kal)\b/))) {
    const d = addDays(now, -1);
    const p = addDays(now, -2);
    return make(d, d, "yesterday", { start: p, end: p, label: "the day before" }, m);
  }
  if ((m = t.match(/\b(this week|is hafte)\b/))) {
    const back = (now.getDay() + 6) % 7; // Monday first
    const s = addDays(now, -back);
    return make(s, today, "this week", { start: addDays(s, -7), end: addDays(today, -7), label: "the same days last week" }, m);
  }
  if ((m = t.match(/\b(last|past|previous)\s+(7\s+days|seven\s+days|week)\b/))) {
    if (/7|seven/.test(m[2])) {
      const s = addDays(now, -6);
      return make(s, today, "the last 7 days", { start: addDays(s, -7), end: addDays(today, -7), label: "the 7 days before" }, m);
    }
    const back = (now.getDay() + 6) % 7;
    const s = addDays(now, -back - 7);
    const e = addDays(s, 6);
    return make(s, e, "last week", { start: addDays(s, -7), end: addDays(e, -7), label: "the week before" }, m);
  }
  if ((m = t.match(/\b(?:last|past)\s+(\d{1,2}|two|three|six|twelve)\s+months\b/))) {
    const words: Record<string, number> = { two: 2, three: 3, six: 6, twelve: 12 };
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : words[m[1]];
    if (n >= 1 && n <= 24) {
      const s = at(y, mo - n + 1, 1);
      const ps = at(y, mo - 2 * n + 1, 1);
      const pe = at(y, mo - n + 1, 0);
      return make(s, today, `the last ${n} months`, { start: ps, end: pe, label: `the ${n} months before` }, m);
    }
  }
  if ((m = t.match(/\b(this month|is mahine|so far this month|month so far)\b/))) {
    const [py, pm] = prevMonth(y, mo);
    const pe = at(py, pm, Math.min(now.getDate(), lastDay(py, pm)));
    return make(at(y, mo, 1), today, "this month", { start: at(py, pm, 1), end: pe, label: `the same days of ${MONTH_NAMES[pm][0].toUpperCase() + MONTH_NAMES[pm].slice(1)}` }, m);
  }
  if ((m = t.match(/\b(last month|previous month|pichhle mahine|pichle mahine)\b/))) {
    const [py, pm] = prevMonth(y, mo);
    const [qy, qm] = prevMonth(py, pm);
    const r = monthRange(py, pm);
    const q = monthRange(qy, qm);
    return make(new Date(r.start + "T12:00"), new Date(r.end + "T12:00"), cap(MONTH_NAMES[pm]), { start: new Date(q.start + "T12:00"), end: new Date(q.end + "T12:00"), label: cap(MONTH_NAMES[qm]) }, m);
  }
  if ((m = t.match(/\b(this|current)\s+(?:financial|fiscal)\s+year\b|\bthis fy\b/)) || (fyStartMonth !== 1 && (m = t.match(/\bthis year\b/)))) {
    const fs = fyStartMonth - 1;
    const sy = mo >= fs ? y : y - 1;
    const s = at(sy, fs, 1);
    return make(s, today, "this financial year", { start: at(sy - 1, fs, 1), end: addYears(today, -1), label: "the same stretch last year" }, m);
  }
  if ((m = t.match(/\b(last|previous)\s+(?:financial|fiscal)\s+year\b|\blast fy\b/))) {
    const fs = fyStartMonth - 1;
    const sy = (mo >= fs ? y : y - 1) - 1;
    return make(at(sy, fs, 1), at(sy + 1, fs, 0), "last financial year", { start: at(sy - 1, fs, 1), end: at(sy, fs, 0), label: "the year before" }, m);
  }
  if ((m = t.match(/\bthis year\b/))) {
    return make(at(y, 0, 1), today, `${y} so far`, { start: at(y - 1, 0, 1), end: addYears(today, -1), label: `the same stretch of ${y - 1}` }, m);
  }
  if ((m = t.match(/\blast year\b/))) {
    return make(at(y - 1, 0, 1), at(y - 1, 11, 31), String(y - 1), { start: at(y - 2, 0, 1), end: at(y - 2, 11, 31), label: String(y - 2) }, m);
  }
  // "in October", "for October 2026": a whole month (the latest one that has started).
  if ((m = t.match(new RegExp(`\\b(?:in|for|during|of)?\\s*${MONTH_RE}(?:\\s+(\\d{4}))?\\b`)))) {
    const mi = monthIndex(m[1]);
    // "may" is also a word: only as a month after in/for/during/of.
    if (mi >= 0 && !(mi === 4 && !/\b(in|for|during|of)\s+may\b/.test(m[0]))) {
      let my = m[2] ? parseInt(m[2], 10) : y;
      if (!m[2] && mi > mo) my -= 1;
      const r = monthRange(my, mi);
      const [qy, qm] = prevMonth(my, mi);
      const q = monthRange(qy, qm);
      const end = capped(new Date(r.end + "T12:00"), today);
      return make(new Date(r.start + "T12:00"), end, cap(MONTH_NAMES[mi]) + (my !== y ? ` ${my}` : ""), { start: new Date(q.start + "T12:00"), end: new Date(q.end + "T12:00"), label: cap(MONTH_NAMES[qm]) }, m);
    }
  }
  return undefined;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
function addYears(d: Date, n: number): Date {
  const y = d.getFullYear() + n;
  return at(y, d.getMonth(), Math.min(d.getDate(), lastDay(y, d.getMonth())));
}

/** "5th Nov" style, for saying a date back. */
export function shortDay(dateIso: string): string {
  const [, m, d] = dateIso.split("-").map(Number);
  return `${d}${ordinal(d)} ${SHORT_MONTHS[m - 1]}`;
}
