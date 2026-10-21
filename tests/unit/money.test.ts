import { describe, expect, it } from "vitest";
import { roundMoney, roundUnit, sumMoney, toMoneyString } from "@/lib/money";

describe("money helpers", () => {
  it("rounds half-up to paise", () => {
    expect(roundMoney("10.005").toFixed(2)).toBe("10.01");
    expect(roundMoney("10.004").toFixed(2)).toBe("10.00");
  });

  it("avoids float drift when summing", () => {
    expect(sumMoney(["0.1", "0.2"]).toFixed(2)).toBe("0.30");
  });

  it("rounds unit prices to 4 dp", () => {
    expect(roundUnit("16.727272").toFixed(4)).toBe("16.7273");
  });

  it("formats numeric strings for the database", () => {
    expect(toMoneyString(200000)).toBe("200000.00");
  });
});
