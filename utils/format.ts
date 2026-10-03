export function formatMoney(amount: number, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount);
}

export function formatServicePrice(amount: number, currency = "PHP"): string {
  return amount > 0 ? formatMoney(amount, currency) : "Price to be confirmed";
}

export function formatServiceDuration(minutes: number, isEstimate = false): string {
  return isEstimate ? `Approx. ${minutes} min (estimate)` : `${minutes} minutes`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
