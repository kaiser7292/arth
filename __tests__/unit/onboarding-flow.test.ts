import { continueAfterAi, goNextStep } from "../../services/onboarding-flow";

describe("onboarding routes", () => {
  const router = () => {
    const push = jest.fn();
    return { push, r: { push } as never };
  };

  it("manual route: no rest, the fallback comes next", () => {
    const { push, r } = router();
    goNextStep(r, undefined, "budget");
    expect(push).toHaveBeenCalledWith("/(onboarding)/budget");
  });

  it("AI route: only the steps the reply left out, then Protect", () => {
    const a = router();
    continueAfterAi(a.r, { set_income: 1 });
    expect(a.push).toHaveBeenCalledWith({ pathname: "/(onboarding)/budget", params: { rest: "" } });

    const b = router();
    continueAfterAi(b.r, { set_income: 1, set_budget: 9 });
    expect(b.push).toHaveBeenCalledWith("/(onboarding)/protect");

    const c = router();
    continueAfterAi(c.r, {});
    expect(c.push).toHaveBeenCalledWith({ pathname: "/(onboarding)/income", params: { rest: "budget" } });
  });

  it("a step with an empty rest goes to Protect", () => {
    const { push, r } = router();
    goNextStep(r, "", "budget");
    expect(push).toHaveBeenCalledWith("/(onboarding)/protect");
  });
});
