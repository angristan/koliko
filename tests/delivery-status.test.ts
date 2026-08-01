import { describe, expect, it, vi } from "vitest"
import { createDeliveryStatusFeedback } from "../collectors/pi/delivery-status"

describe("delivery status", () => {
  it("reports failures and recovery only in the footer", () => {
    const ui = {
      setStatus: vi.fn(),
      notify: vi.fn()
    }
    const feedback = createDeliveryStatusFeedback(() => ui)

    feedback.onFailure("offline")
    feedback.onRecovery()

    expect(ui.setStatus).toHaveBeenNthCalledWith(1, "koliko-delivery", "Koliko: delivery failed")
    expect(ui.setStatus).toHaveBeenNthCalledWith(2, "koliko-delivery", undefined)
    expect(ui.notify).not.toHaveBeenCalled()
  })
})
