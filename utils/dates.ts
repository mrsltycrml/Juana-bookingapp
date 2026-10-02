export function businessDateKey(value: string | Date): string {
  const date = value instanceof Date
    ? value
    : /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+08:00`) : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not format the business date.");
  return `${year}-${month}-${day}`;
}

export function manilaDate(offsetDays = 0): Date {
  const [year, month, day] = businessDateKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offsetDays, 12));
}
