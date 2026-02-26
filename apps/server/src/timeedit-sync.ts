import { parseICS, ImportedCalendarEvent } from "./calendar-import.js";
import { filterTPEventsByDateWindow } from "./integration-date-window.js";
import { LectureEvent } from "./types.js";

export interface TimeEditSyncResult {
  success: boolean;
  eventsProcessed: number;
  lecturesCreated: number;
  lecturesUpdated: number;
  lecturesDeleted: number;
  error?: string;
}

export interface TimeEditFetchOptions {
  icalUrl: string;
  pastDays?: number;
  futureDays?: number;
}

/**
 * Fetch and parse events from a TimeEdit iCal subscription URL.
 * TimeEdit uses standard iCalendar format — the same parser as TP works here.
 */
export async function fetchTimeEditSchedule(options: TimeEditFetchOptions): Promise<ImportedCalendarEvent[]> {
  const response = await fetch(options.icalUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch TimeEdit schedule: ${response.status} ${response.statusText}`);
  }

  const icsContent = await response.text();
  const parsed = parseICS(icsContent);
  return filterTPEventsByDateWindow(parsed, {
    pastDays: options.pastDays,
    futureDays: options.futureDays
  });
}

/**
 * Convert a TimeEdit calendar event to a LectureEvent.
 * TimeEdit iCal events follow the same VEVENT structure as TP EduCloud.
 */
export function convertTimeEditEventToLecture(event: ImportedCalendarEvent): Omit<LectureEvent, "id"> {
  const durationMinutes = event.endTime
    ? Math.max(15, Math.round((new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60000))
    : 90;

  let workload: "low" | "medium" | "high" = "medium";
  const summaryLower = event.summary.toLowerCase();

  if (summaryLower.includes("exam") || summaryLower.includes("eksamen") || summaryLower.includes("tentamen")) {
    workload = "high";
  } else if (
    summaryLower.includes("lecture") ||
    summaryLower.includes("forelesning") ||
    summaryLower.includes("föreläsning") ||
    summaryLower.includes("lab")
  ) {
    workload = "medium";
  } else if (
    summaryLower.includes("guidance") ||
    summaryLower.includes("veiledning") ||
    summaryLower.includes("handledning")
  ) {
    workload = "low";
  }

  return {
    title: event.summary,
    ...(event.location ? { location: event.location } : {}),
    startTime: event.startTime,
    durationMinutes,
    workload,
    recurrenceParentId: "timeedit-import"
  };
}

export function generateTimeEditEventKey(event: ImportedCalendarEvent): string {
  return `timeedit-${event.summary}-${event.startTime}`;
}

/**
 * Diff existing schedule events (timeedit-imported) against freshly-fetched events.
 */
export function diffTimeEditScheduleEvents(
  existingEvents: LectureEvent[],
  newEvents: ImportedCalendarEvent[]
): {
  toCreate: Array<Omit<LectureEvent, "id">>;
  toUpdate: Array<{ id: string; event: Partial<Omit<LectureEvent, "id">> }>;
  toDelete: string[];
} {
  const existingMap = new Map<string, LectureEvent>();
  for (const event of existingEvents) {
    if (event.recurrenceParentId === "timeedit-import") {
      const key = `timeedit-${event.title}-${event.startTime}`;
      existingMap.set(key, event);
    }
  }

  const newMap = new Map<string, ImportedCalendarEvent>();
  for (const event of newEvents) {
    const key = generateTimeEditEventKey(event);
    newMap.set(key, event);
  }

  const toCreate: Array<Omit<LectureEvent, "id">> = [];
  const toUpdate: Array<{ id: string; event: Partial<Omit<LectureEvent, "id">> }> = [];
  const toDelete: string[] = [];

  for (const [key, newEvent] of newMap) {
    const existing = existingMap.get(key);

    if (!existing) {
      toCreate.push(convertTimeEditEventToLecture(newEvent));
    } else {
      const converted = convertTimeEditEventToLecture(newEvent);

      if (
        existing.durationMinutes !== converted.durationMinutes ||
        existing.workload !== converted.workload ||
        (existing.location ?? null) !== (converted.location ?? null)
      ) {
        toUpdate.push({
          id: existing.id,
          event: {
            durationMinutes: converted.durationMinutes,
            workload: converted.workload,
            ...(converted.location ? { location: converted.location } : { location: undefined })
          }
        });
      }

      existingMap.delete(key);
    }
  }

  for (const event of existingMap.values()) {
    toDelete.push(event.id);
  }

  return { toCreate, toUpdate, toDelete };
}
