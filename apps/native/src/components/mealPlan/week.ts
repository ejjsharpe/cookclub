// Date helpers for the week-at-a-time meal plan. Weeks start on Monday.

export interface WeekDay {
  date: Date;
  dateString: string;
  isToday: boolean;
  isPast: boolean;
}

const LONG_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const toDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/** Midnight on the Monday of the week containing `date`. */
export const startOfWeek = (date: Date): Date => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (start.getDay() + 6) % 7; // Monday = 0
  return addDays(start, -offset);
};

export const getWeekDays = (weekStart: Date, today: Date): WeekDay[] => {
  const todayString = toDateString(today);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateString = toDateString(date);
    return {
      date,
      dateString,
      isToday: dateString === todayString,
      isPast: dateString < todayString,
    };
  });
};

export const longDayName = (date: Date) => LONG_DAYS[date.getDay()]!;

/** "17 – 23 November", or "30 November – 6 December" across months. */
export const formatWeekRange = (weekStart: Date): string => {
  const end = addDays(weekStart, 6);
  const endPart = `${end.getDate()} ${MONTHS[end.getMonth()]}`;
  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.getDate()} – ${endPart}`;
  }
  return `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${endPart}`;
};
