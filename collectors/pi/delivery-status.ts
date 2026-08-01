import type { DeliveryFeedback } from "./delivery-monitor"

interface StatusUI {
  setStatus(id: string, text: string | undefined): void
}

export const createDeliveryStatusFeedback = (
  getUI: () => StatusUI | undefined
): DeliveryFeedback => ({
  onFailure() {
    getUI()?.setStatus("koliko-delivery", "Koliko: delivery failed")
  },
  onRecovery() {
    getUI()?.setStatus("koliko-delivery", undefined)
  }
})
