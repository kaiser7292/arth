/**
 * Onboarding has two routes after the shared start (Welcome → Region → read messages → accounts):
 *
 *   Manual:      Categories → Income → Budgets → Protect → Done
 *   AI assisted: Share file → paste reply → review → Protect → Done, plus only the steps the
 *                AI's reply left out (Income if it set none, Budgets if it set none)
 *
 * Steps that can sit in either route take a `rest` param: the steps still to come, in order. With
 * it, a step goes to the next one listed (or Protect when none are left); without it, the manual
 * route's order applies.
 */

type Router = { push: (href: never) => void };

export type OptionalStep = "income" | "budget";

/** Go to the next onboarding step. `fallback` is the manual route's next step. */
export function goNextStep(router: Router, rest: string | undefined, fallback: string): void {
  if (rest === undefined) {
    router.push(`/(onboarding)/${fallback}` as never);
    return;
  }
  const list = rest.split(",").filter(Boolean);
  if (list.length === 0) {
    router.push("/(onboarding)/protect" as never);
    return;
  }
  router.push({ pathname: `/(onboarding)/${list[0]}`, params: { rest: list.slice(1).join(",") } } as never);
}

/** After the AI's setup is applied: the steps it didn't cover, then Protect. */
export function continueAfterAi(router: Router, applied: { set_income?: number; set_budget?: number }): void {
  const missing: OptionalStep[] = [];
  if (!applied.set_income) missing.push("income");
  if (!applied.set_budget) missing.push("budget");
  goNextStep(router, missing.join(","), "protect");
}
