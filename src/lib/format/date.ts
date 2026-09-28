import { readable } from 'svelte/store';

/**
 * Human-readable dates: "just now", "5 minutes ago", "Yesterday at 3:40 PM",
 * "Monday at 9:15 AM", "Sep 28" (this year) or "Dec 20, 2024".
 *
 * Accepts full ISO timestamps and date-only strings like `2024-12-20`. Date-only
 * values are read as local calendar dates, not UTC midnight (which would show
 * as the previous day west of Greenwich), and are never given a time.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parse(value: string | Date): { date: Date; dateOnly: boolean } {
	if (value instanceof Date) return { date: value, dateOnly: false };
	if (DATE_ONLY.test(value)) {
		const [y, m, d] = value.split('-').map(Number);
		return { date: new Date(y, m - 1, d), dateOnly: true };
	}
	return { date: new Date(value), dateOnly: false };
}

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const DAY_MS = 86_400_000;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Whole calendar days from `date` to `now`; 0 is today, 1 yesterday, -1 tomorrow. */
function daysAgo(date: Date, now: Date) {
	return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
}

export function formatRelative(value: string | Date, now: Date = new Date()): string {
	const { date, dateOnly } = parse(value);
	if (Number.isNaN(date.getTime())) return '—';

	const days = daysAgo(date, now);

	if (!dateOnly) {
		const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
		// Small negative values are clock skew between server and browser.
		if (seconds < 45 && seconds > -60) return 'just now';
		if (seconds > 0 && seconds < 3600) return relative.format(-Math.round(seconds / 60), 'minute');
		if (seconds > 0 && seconds < 6 * 3600 && days === 0) {
			return relative.format(-Math.round(seconds / 3600), 'hour');
		}
	}

	const at = dateOnly ? '' : ` at ${timeFormat.format(date)}`;
	if (days === 0) return dateOnly ? 'Today' : `Today${at}`;
	if (days === 1) return `Yesterday${at}`;
	if (days > 1 && days < 7) return `${weekdayFormat.format(date)}${at}`;
	if (date.getFullYear() === now.getFullYear()) return monthDayFormat.format(date);
	return fullDateFormat.format(date);
}

/** The exact moment, for tooltips: "Sep 28, 2026, 6:46:12 AM". */
export function formatFull(value: string | Date): string {
	const { date, dateOnly } = parse(value);
	if (Number.isNaN(date.getTime())) return '';
	return dateOnly
		? date.toLocaleDateString(undefined, { dateStyle: 'full' })
		: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

/**
 * Ticks every 30 seconds so relative labels ("2 minutes ago") stay current.
 * The timer only runs while something is subscribed.
 */
export const now = readable(new Date(), (set) => {
	const id = setInterval(() => set(new Date()), 30_000);
	return () => clearInterval(id);
});
