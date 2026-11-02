const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day heading in a transaction list: "Today · 2 Nov", "Monday · 27 Oct", "12 Sep", "12 Sep 2025". */
export function transactionDayLabel(date: string, now: Date = new Date()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  const d = new Date(`${date}T00:00:00`);
  const dayMonth = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (d.getTime() === today.getTime()) return `Today · ${dayMonth}`;
  if (d.getTime() === yesterday.getTime()) return `Yesterday · ${dayMonth}`;
  if (d >= sevenDaysAgo) return `${WEEKDAYS[d.getDay()]} · ${dayMonth}`;
  if (d.getFullYear() === today.getFullYear()) return dayMonth;
  return `${dayMonth} ${d.getFullYear()}`;
}
