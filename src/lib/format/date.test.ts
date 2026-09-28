import { describe, expect, it } from 'vitest';
import { formatRelative } from './date';

// Local time, Wednesday 30 September 2026, 14:00.
const now = new Date(2026, 8, 30, 14, 0, 0);
const at = (...args: [number, number, number, number?, number?, number?]) =>
	new Date(...(args as [number, number, number])).toISOString();
const time = (h: number, m: number) =>
	new Date(2026, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

describe('formatRelative', () => {
	it('says "just now" for the last few seconds, and for small clock skew', () => {
		expect(formatRelative(at(2026, 8, 30, 13, 59, 30), now)).toBe('just now');
		expect(formatRelative(at(2026, 8, 30, 14, 0, 20), now)).toBe('just now');
	});

	it('counts minutes, then hours, within today', () => {
		expect(formatRelative(at(2026, 8, 30, 13, 55), now)).toMatch(/5 minutes ago/);
		expect(formatRelative(at(2026, 8, 30, 11, 0), now)).toMatch(/3 hours ago/);
	});

	it('uses Today / Yesterday / weekday with the time', () => {
		expect(formatRelative(at(2026, 8, 30, 6, 15), now)).toBe(`Today at ${time(6, 15)}`);
		expect(formatRelative(at(2026, 8, 29, 23, 30), now)).toBe(`Yesterday at ${time(23, 30)}`);
		expect(formatRelative(at(2026, 8, 27, 9, 5), now)).toMatch(new RegExp(`^\\w+ at ${time(9, 5)}$`));
	});

	it('falls back to a date, with the year only when it differs', () => {
		expect(formatRelative(at(2026, 5, 1, 10, 0), now)).not.toMatch(/2026/);
		expect(formatRelative(at(2024, 11, 20, 10, 0), now)).toMatch(/2024/);
	});

	it('reads date-only strings as local calendar days, without a time', () => {
		expect(formatRelative('2026-09-30', now)).toBe('Today');
		expect(formatRelative('2026-09-29', now)).toBe('Yesterday');
		expect(formatRelative('2024-12-20', now)).toMatch(/20.*2024|2024.*20/);
	});

	it('shows a dash for unparseable input', () => {
		expect(formatRelative('not a date', now)).toBe('—');
	});
});
