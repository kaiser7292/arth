/** Round to nearest integer paise (used for stored monetary amounts). */
export function round2(n: number): number {
  return Math.round(n);
}

/** Convert user-entered rupees to integer paise for DB storage. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Convert paise back to rupees for display (prefer formatAmount instead). */
export function toRupees(paise: number): number {
  return paise / 100;
}
