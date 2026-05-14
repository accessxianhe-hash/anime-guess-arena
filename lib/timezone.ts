export function toDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function toWeekKey(date: Date, timeZone: string) {
  const dateKey = toDateKey(date, timeZone);
  const [yearText, monthText, dayText] = dateKey.split("-");
  const localDate = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)),
  );
  const day = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() + 4 - day);

  const weekYear = localDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil(
    ((localDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );

  return `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}
