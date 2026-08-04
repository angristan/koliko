export const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
export const integer = new Intl.NumberFormat("en")
export const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.round(milliseconds / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

export const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback
