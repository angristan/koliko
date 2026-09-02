import { describe, expect, it } from "vitest"
import { compactMoney, summaryMoney } from "../src/dashboard/features/analytics/chartSupport"

describe("chart currency formatting", () => {
  it("keeps axis labels compact while preserving exact detail values", () => {
    expect([0, 1_500, 4_500, 99_218].map((value) => compactMoney.format(value))).toEqual([
      "$0",
      "$1.5K",
      "$4.5K",
      "$99.2K"
    ])
    expect(summaryMoney.format(4_500)).toBe("$4,500.00")
  })
})
