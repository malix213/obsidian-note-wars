import { Editor } from "obsidian";

// Regex patterns for timestamp detection
// Time range pattern: HH:MM:SS - HH:MM:SS or HH:MM - HH:MM (with optional seconds)
const TIME_RANGE_REGEX =
	/(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/g;

// Individual timestamp patterns
const FULL_DATETIME_REGEX = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g;
const TIME_ONLY_REGEX = /\d{1,2}:\d{2}(?::\d{2})?/g;

export interface TimestampMatch {
	text: string;
	lineNumber: number;
	lineContent: string;
	startChar: number;
	endChar: number;
	isTimeSlot?: boolean; // Flag to indicate if this is a time range/slot
}

/**
 * Scans the given text content for timestamp patterns.
 * Prioritizes time ranges (e.g., "00:02:18 - 00:02:58") over individual timestamps.
 * @param text The text content to scan.
 * @returns An array of TimestampMatch objects.
 */
export function scanForTimestamps(text: string): TimestampMatch[] {
	const timestamps: TimestampMatch[] = [];
	const lines = text.split("\n");

	lines.forEach((lineContent, lineNumber) => {
		// Track positions that are already matched by time ranges
		const excludedRanges: Array<{ start: number; end: number }> = [];

		// First pass: Find all time ranges (time slots)
		let rangeMatch;
		TIME_RANGE_REGEX.lastIndex = 0; // Reset regex state
		while ((rangeMatch = TIME_RANGE_REGEX.exec(lineContent)) !== null) {
			timestamps.push({
				text: rangeMatch[0], // Full range text (e.g., "00:02:18 - 00:02:58")
				lineNumber: lineNumber + 1,
				lineContent: lineContent,
				startChar: rangeMatch.index,
				endChar: rangeMatch.index + rangeMatch[0].length,
				isTimeSlot: true,
			});
			// Mark this range as excluded for individual timestamp detection
			excludedRanges.push({
				start: rangeMatch.index,
				end: rangeMatch.index + rangeMatch[0].length,
			});
		}

		// Second pass: Find full datetime stamps (not affected by time ranges)
		let datetimeMatch;
		FULL_DATETIME_REGEX.lastIndex = 0;
		while ((datetimeMatch = FULL_DATETIME_REGEX.exec(lineContent)) !== null) {
			const matchStart = datetimeMatch.index;
			const matchEnd = matchStart + datetimeMatch[0].length;

			// Check if this position overlaps with any time range
			const isExcluded = excludedRanges.some(
				(range) => matchStart < range.end && matchEnd > range.start
			);

			if (!isExcluded) {
				timestamps.push({
					text: datetimeMatch[0],
					lineNumber: lineNumber + 1,
					lineContent: lineContent,
					startChar: matchStart,
					endChar: matchEnd,
				});
			}
		}

		// Third pass: Find individual time-only stamps (excluding those in ranges)
		let timeMatch;
		TIME_ONLY_REGEX.lastIndex = 0;
		while ((timeMatch = TIME_ONLY_REGEX.exec(lineContent)) !== null) {
			const matchStart = timeMatch.index;
			const matchEnd = matchStart + timeMatch[0].length;

			// Check if this position overlaps with any excluded range
			const isExcluded = excludedRanges.some(
				(range) => matchStart < range.end && matchEnd > range.start
			);

			if (!isExcluded) {
				timestamps.push({
					text: timeMatch[0],
					lineNumber: lineNumber + 1,
					lineContent: lineContent,
					startChar: matchStart,
					endChar: matchEnd,
				});
			}
		}
	});

	// Sort timestamps by line number, then by character position
	timestamps.sort((a, b) => {
		if (a.lineNumber !== b.lineNumber) {
			return a.lineNumber - b.lineNumber;
		}
		return a.startChar - b.startChar;
	});

	return timestamps;
}

/**
 * Placeholder for more sophisticated timestamp parsing and validation if needed.
 * For now, we assume the regex is sufficient.
 */
export function parseTimestamp(timestampString: string): Date | null {
	// Attempt to parse using common formats.
	// This can be extended with more robust parsing logic.
	// A more robust date parsing library like 'date-fns' or 'moment.js' would be ideal here
	// but for a simple example, we'll try a basic Date constructor approach.
	try {
		const date = new Date(timestampString);
		if (!isNaN(date.getTime())) {
			return date;
		}
	} catch {
		// Ignore parsing errors
	}
	return null;
}

export function goToTimestampLine(editor: Editor, lineNumber: number) {
	// Line number is 1-based in our interface, but setCursor is 0-based
	const lineIndex = Math.max(0, lineNumber - 1);
	editor.setCursor({ line: lineIndex, ch: 0 });
	editor.scrollIntoView({ from: { line: lineIndex, ch: 0 }, to: { line: lineIndex, ch: 0 } }, true);
}
