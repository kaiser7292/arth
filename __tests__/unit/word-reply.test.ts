/** Ask Arth's reply worded by on-device AI is checked against the worked-out figures. */
jest.mock("@/services/ai/nano", () => ({ askNano: jest.fn() }));
import { checkReply, replyFacts } from "@/services/ai/tasks/word-reply";

const answer = {
  sentence: "By 15 Nov you'd spent ₹4,000, ₹1,000 less than 1–15 Oct. Most of it went on Groceries (₹2,500) and Food (₹1,500).",
  figures: [
    { label: "1–15 Nov", value: "₹4,000" },
    { label: "1–15 Oct", value: "₹5,000" },
  ],
  expenseIds: [],
  seeTitle: "",
};
const facts = replyFacts(answer);

describe("worded reply", () => {
  it("keeps a reply whose numbers and names are all in the facts", () => {
    const r = "You've spent ₹4,000 so far this month, ₹1,000 less than the same days of October. Groceries took the most, at ₹2,500.";
    expect(checkReply(r, facts)).toBe(r);
  });
  it("drops a reply with an amount that isn't in the facts", () => {
    expect(checkReply("You've spent ₹4,200 so far.", facts)).toBeNull();
  });
  it("drops a reply naming something that isn't in the facts", () => {
    expect(checkReply("Most of it went on Swiggy.", facts)).toBeNull();
  });
  it("drops 'more' when the facts say less", () => {
    expect(checkReply("You spent ₹1,000 more than October.", facts)).toBeNull();
  });
  it("drops an empty or rambling reply", () => {
    expect(checkReply("", facts)).toBeNull();
    expect(checkReply("A. B. C. D.", facts)).toBeNull();
  });
});
