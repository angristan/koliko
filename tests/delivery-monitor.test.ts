import { describe, expect, it, vi } from "vitest"
import { DeliveryMonitor } from "../collectors/pi/delivery-monitor"

describe("delivery monitor", () => {
  it("warns once per outage and reports recovery", async () => {
    const onFailure = vi.fn()
    const onRecovery = vi.fn()
    const queue = {
      flush: vi.fn()
        .mockRejectedValueOnce(new Error("Koliko ingest returned HTTP 403"))
        .mockRejectedValueOnce(new Error("Koliko ingest returned HTTP 403"))
        .mockResolvedValueOnce(2)
    }
    const monitor = new DeliveryMonitor({ onFailure, onRecovery })

    await expect(monitor.flush(queue)).rejects.toThrow("HTTP 403")
    await expect(monitor.flush(queue)).rejects.toThrow("HTTP 403")

    expect(monitor.isFailing).toBe(true)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith("Koliko ingest returned HTTP 403")
    expect(onRecovery).not.toHaveBeenCalled()

    await expect(monitor.flush(queue)).resolves.toBe(2)

    expect(monitor.isFailing).toBe(false)
    expect(onRecovery).toHaveBeenCalledOnce()
  })

  it("can reset failure state without announcing recovery", async () => {
    const onFailure = vi.fn()
    const onRecovery = vi.fn()
    const queue = { flush: vi.fn().mockRejectedValue(new Error("offline")) }
    const monitor = new DeliveryMonitor({ onFailure, onRecovery })

    await expect(monitor.flush(queue)).rejects.toThrow("offline")
    monitor.reset()

    expect(monitor.isFailing).toBe(false)
    expect(onRecovery).not.toHaveBeenCalled()
  })
})
