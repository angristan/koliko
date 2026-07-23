export interface FlushableQueue {
  flush(signal?: AbortSignal): Promise<number>
}

export interface DeliveryFeedback {
  onFailure(message: string): void
  onRecovery(): void
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown collector delivery error"

export class DeliveryMonitor {
  private failing = false

  constructor(private readonly feedback: DeliveryFeedback) {}

  get isFailing(): boolean {
    return this.failing
  }

  async flush(queue: FlushableQueue, signal?: AbortSignal): Promise<number> {
    try {
      const sent = await queue.flush(signal)
      if (this.failing) {
        this.failing = false
        this.feedback.onRecovery()
      }
      return sent
    } catch (error) {
      if (!this.failing) {
        this.failing = true
        this.feedback.onFailure(errorMessage(error))
      }
      throw error
    }
  }

  reset(): void {
    this.failing = false
  }
}
