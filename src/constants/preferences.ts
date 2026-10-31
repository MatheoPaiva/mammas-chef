export const CUISINE_OPTIONS = [
  "Mediterranean", "Middle Eastern", "Mexican", "Asian", "Italian", "Comfort", "Indian",
];

export const DIETARY_OPTIONS = [
  "Vegetarian", "Vegan", "Keto", "Paleo", "Gluten-Free", "Dairy-Free", "Mediterranean", "Low-Carb", "Whole30",
];

export const ALLERGY_OPTIONS = [
  "Nuts", "Peanuts", "Shellfish", "Eggs", "Soy", "Wheat", "Fish", "Sesame", "Milk",
];

export const WEEK_START_OPTIONS = ["Sunday", "Monday"] as const;

export const ALL_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/** Returns the 7 days in order starting from the given day. */
export function getOrderedDays(startDay: string): string[] {
  const idx = ALL_WEEKDAYS.indexOf(startDay as typeof ALL_WEEKDAYS[number]);
  if (idx === -1) return [...ALL_WEEKDAYS];
  return [...ALL_WEEKDAYS.slice(idx), ...ALL_WEEKDAYS.slice(0, idx)];
}

/** Returns the day before the start day (the prep day). */
export function getBatchCookDay(startDay: string): string {
  const idx = ALL_WEEKDAYS.indexOf(startDay as typeof ALL_WEEKDAYS[number]);
  if (idx === -1) return "Sunday";
  return ALL_WEEKDAYS[(idx + 6) % 7];
}

/** Returns the next occurrence of the given weekday (today if today matches). */
export function getNextStartDate(startDay: string): Date {
  const dayIndex = ALL_WEEKDAYS.indexOf(startDay as typeof ALL_WEEKDAYS[number]);
  if (dayIndex === -1) return new Date();
  const today = new Date();
  const todayIndex = today.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (dayIndex - todayIndex + 7) % 7;
  const result = new Date(today);
  result.setDate(today.getDate() + diff);
  return result;
}
