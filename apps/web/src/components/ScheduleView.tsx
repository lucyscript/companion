import { useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";
import { getDeadlines, getSchedule, getScheduleSuggestionMutes } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Deadline, LectureEvent, ScheduleSuggestionMute } from "../types";

interface DayTimelineSegment {
  type: "event" | "planned";
  start: Date;
  end: Date;
  event?: LectureEvent;
  suggestion?: string;
}

interface DayTrackEventSegment {
  id: string;
  startPercent: number;
  widthPercent: number;
}

const DAY_TOTAL_MINUTES = 24 * 60;
const DAY_TRACK_TICKS = [0, 6, 12, 18, 24];

function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function startOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayOffsetFromToday(targetDate: Date): number {
  const today = startOfDay(new Date());
  const target = startOfDay(targetDate);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function minuteOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

function toDayTrackPosition(start: Date, end: Date): { startPercent: number; widthPercent: number } {
  const startMinutes = Math.max(0, Math.min(DAY_TOTAL_MINUTES, minuteOfDay(start)));
  const rawEnd = Math.max(startMinutes + 5, Math.min(DAY_TOTAL_MINUTES, minuteOfDay(end)));
  const endMinutes = rawEnd <= startMinutes ? Math.min(DAY_TOTAL_MINUTES, startMinutes + 30) : rawEnd;
  return {
    startPercent: (startMinutes / DAY_TOTAL_MINUTES) * 100,
    widthPercent: Math.max(1.2, ((endMinutes - startMinutes) / DAY_TOTAL_MINUTES) * 100)
  };
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function formatLectureTitle(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\[nN]/g, "\n")
    .replace(/\s*\n+\s*/g, " / ")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/^\/+\s*|\s*\/+$/g, "")
    .trim();
}

function formatRoomLabel(location: string | undefined): string | null {
  if (!location || location.trim().length === 0) {
    return null;
  }

  const compact = location.replace(/\r\n/g, " ").replace(/\s+/g, " ").trim();
  const explicitRoom = compact.match(/\b([A-Za-z]{1,4}-\d{2,4}[A-Za-z]?)\b/);
  if (explicitRoom?.[1]) {
    return explicitRoom[1].toUpperCase();
  }

  const spacedRoom = compact.match(/\b([A-Za-z]{1,4})\s+(\d{2,4}[A-Za-z]?)\b/);
  if (spacedRoom?.[1] && spacedRoom?.[2]) {
    return `${spacedRoom[1]}-${spacedRoom[2]}`.toUpperCase();
  }

  const segment = compact.split(/[,;|]/).map((value) => value.trim()).filter(Boolean).pop() ?? compact;
  return segment.replace(/\s*-\s*/g, "-");
}

function suggestGapActivity(
  gapStart: Date,
  gapDurationMinutes: number,
  deadlineSuggestions: string[],
  consumedDeadlineIndex: { value: number },
  t: (text: string, vars?: Record<string, string | number>) => string
): string {
  const hour = gapStart.getHours();

  if (hour < 9) {
    return t("Morning routine (gym, breakfast, planning)");
  }

  if (consumedDeadlineIndex.value < deadlineSuggestions.length) {
    const suggestion = deadlineSuggestions[consumedDeadlineIndex.value]!;
    consumedDeadlineIndex.value += 1;
    return suggestion;
  }

  if (gapDurationMinutes >= 90) {
    return t("Focus block for assignments or revision");
  }

  return t("Buffer, review notes, or take a short reset");
}

function allocatePlannedBlocks(
  start: Date,
  end: Date,
  deadlineSuggestions: string[],
  consumedDeadlineIndex: { value: number },
  t: (text: string, vars?: Record<string, string | number>) => string
): DayTimelineSegment[] {
  const segments: DayTimelineSegment[] = [];
  let cursor = new Date(start);
  let remaining = minutesBetween(cursor, end);

  while (remaining >= 25) {
    let blockMinutes: number;
    if (remaining >= 210) {
      blockMinutes = 90;
    } else if (remaining >= 140) {
      blockMinutes = 75;
    } else if (remaining >= 95) {
      blockMinutes = 60;
    } else if (remaining >= 70) {
      blockMinutes = 45;
    } else {
      blockMinutes = remaining;
    }

    const leftover = remaining - blockMinutes;
    if (leftover > 0 && leftover < 25) {
      blockMinutes = remaining;
    }

    const blockEnd = new Date(cursor.getTime() + blockMinutes * 60000);
    segments.push({
      type: "planned",
      start: new Date(cursor),
      end: blockEnd,
      suggestion: suggestGapActivity(new Date(cursor), blockMinutes, deadlineSuggestions, consumedDeadlineIndex, t)
    });

    cursor = blockEnd;
    remaining = minutesBetween(cursor, end);
  }

  return segments;
}

function formatDayTimelineLabel(
  segment: DayTimelineSegment,
  t: (text: string, vars?: Record<string, string | number>) => string
): string {
  if (segment.type !== "event") {
    return segment.suggestion ?? t("Focus block");
  }

  const title = formatLectureTitle(segment.event?.title ?? t("Scheduled block"));
  const roomLabel = formatRoomLabel(segment.event?.location);
  return roomLabel ? `${title} • ${roomLabel}` : title;
}

function buildDayTimeline(
  scheduleBlocks: LectureEvent[],
  referenceDate: Date,
  deadlineSuggestions: string[],
  suggestionMutes: ScheduleSuggestionMute[],
  t: (text: string, vars?: Record<string, string | number>) => string
): DayTimelineSegment[] {
  const sorted = [...scheduleBlocks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const firstStart = sorted.length > 0 ? new Date(sorted[0].startTime) : new Date(referenceDate);
  const timelineStart = new Date(referenceDate);
  timelineStart.setHours(Math.min(7, firstStart.getHours()), 0, 0, 0);

  const lastLecture = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const lastEnd = lastLecture
    ? new Date(new Date(lastLecture.startTime).getTime() + lastLecture.durationMinutes * 60000)
    : new Date(referenceDate);
  const timelineEnd = new Date(referenceDate);
  timelineEnd.setHours(Math.max(20, lastEnd.getHours() + 1), 0, 0, 0);

  const segments: DayTimelineSegment[] = [];
  let cursor = timelineStart;
  const consumedDeadlineIndex = { value: 0 };

  sorted.forEach((lecture) => {
    const start = new Date(lecture.startTime);
    const end = new Date(start.getTime() + lecture.durationMinutes * 60000);

    const gapMinutes = minutesBetween(cursor, start);
    if (gapMinutes >= 25) {
      segments.push(
        ...allocatePlannedBlocks(new Date(cursor), new Date(start), deadlineSuggestions, consumedDeadlineIndex, t)
      );
    }

    segments.push({
      type: "event",
      start,
      end,
      event: lecture
    });
    cursor = end;
  });

  const trailingGap = minutesBetween(cursor, timelineEnd);
  if (trailingGap >= 25) {
    segments.push(
      ...allocatePlannedBlocks(new Date(cursor), new Date(timelineEnd), deadlineSuggestions, consumedDeadlineIndex, t)
    );
  }

  return segments.filter((segment) => {
    if (segment.type !== "planned") {
      return true;
    }
    return !suggestionMutes.some((mute) => {
      const muteStart = new Date(mute.startTime);
      const muteEnd = new Date(mute.endTime);
      if (Number.isNaN(muteStart.getTime()) || Number.isNaN(muteEnd.getTime())) {
        return false;
      }
      return segment.start.getTime() < muteEnd.getTime() && segment.end.getTime() > muteStart.getTime();
    });
  });
}

interface ScheduleViewProps {
  focusLectureId?: string;
}

export function ScheduleView({ focusLectureId }: ScheduleViewProps): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [schedule, setSchedule] = useState<LectureEvent[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [suggestionMutes, setSuggestionMutes] = useState<ScheduleSuggestionMute[]>([]);
  const [dayOffset, setDayOffset] = useState(0);
  const [dayTransitionDirection, setDayTransitionDirection] = useState<"left" | "right" | null>(null);
  const [dayAnimationKey, setDayAnimationKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const swipeAxisRef = useRef<"x" | "y" | null>(null);
  const dayTransitionTimerRef = useRef<number | null>(null);
  const referenceDate = useMemo(() => addDays(startOfDay(new Date()), dayOffset), [dayOffset]);
  const isReferenceToday = dayOffset === 0;

  useEffect(() => {
    return () => {
      if (dayTransitionTimerRef.current !== null) {
        window.clearTimeout(dayTransitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      try {
        const [nextSchedule, nextDeadlines, nextSuggestionMutes] = await Promise.all([
          getSchedule(),
          getDeadlines(),
          getScheduleSuggestionMutes(new Date())
        ]);
        if (!disposed) {
          setSchedule(nextSchedule);
          setDeadlines(nextDeadlines);
          setSuggestionMutes(nextSuggestionMutes);
        }
      } catch { /* remain in loading state */ }
      if (!disposed) setLoading(false);
    };

    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void load();

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!focusLectureId) {
      return;
    }

    const focusedLecture = schedule.find((lecture) => lecture.id === focusLectureId);
    if (focusedLecture) {
      setDayOffset(dayOffsetFromToday(new Date(focusedLecture.startTime)));
    }

    const timer = window.setTimeout(() => {
      const target = document.getElementById(`lecture-${focusLectureId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusLectureId, schedule]);

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (eventDate.getTime() === today.getTime()) return t("Today");
    if (eventDate.getTime() === tomorrow.getTime()) return t("Tomorrow");
    
    return date.toLocaleDateString(localeTag, { 
      weekday: "short", 
      month: "short", 
      day: "numeric" 
    });
  };

  const getMinutesUntil = (isoString: string): number => {
    const eventTime = new Date(isoString).getTime();
    const now = Date.now();
    return Math.floor((eventTime - now) / 60000);
  };

  const getTimeUntilLabel = (isoString: string): string => {
    const minutesUntil = getMinutesUntil(isoString);
    
    if (minutesUntil < 0) return t("Started");
    if (minutesUntil < 60) return t("in {count}m", { count: minutesUntil });
    
    const hoursUntil = Math.floor(minutesUntil / 60);
    if (hoursUntil < 24) return t("in {count}h", { count: hoursUntil });
    
    const daysUntil = Math.floor(hoursUntil / 24);
    return t("in {count}d", { count: daysUntil });
  };

  const sortedSchedule = [...schedule].sort((a, b) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const pendingDeadlines = deadlines.filter((deadline) => !deadline.completed);
  const deadlineSuggestions = pendingDeadlines
    .map((deadline) => ({
      dueDateMs: new Date(deadline.dueDate).getTime(),
      label: `${deadline.course} ${deadline.task}`
    }))
    .filter((item) => Number.isFinite(item.dueDateMs))
    .sort((left, right) => left.dueDateMs - right.dueDateMs)
    .slice(0, 8)
    .map((item) => item.label);
  const dayBlocks = sortedSchedule.filter((block) => isSameLocalDate(new Date(block.startTime), referenceDate));
  // Only build gap-filler suggestions when there are real schedule events;
  // on a fresh account with no events, show the empty state instead
  const dayTimeline = dayBlocks.length > 0
    ? buildDayTimeline(dayBlocks, referenceDate, deadlineSuggestions, suggestionMutes, t)
    : [];
  const scheduleTitle =
    dayOffset === 0
      ? t("Today's Schedule")
      : dayOffset === 1
        ? t("Tomorrow's Schedule")
        : dayOffset === -1
          ? t("Yesterday's Schedule")
          : t("Schedule");
  const scheduleDateLabel = referenceDate.toLocaleDateString(localeTag, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  const now = new Date();
  const nowPercent = Math.max(0, Math.min(100, (minuteOfDay(now) / DAY_TOTAL_MINUTES) * 100));
  const nowLabel = now.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", hour12: false });
  const nowNearDayTrackEdge = nowPercent > 88;
  const dayTrackSegments: DayTrackEventSegment[] = dayBlocks.map((block, index) => {
    const startDate = new Date(block.startTime);
    const endDate = new Date(startDate.getTime() + block.durationMinutes * 60000);
    const startMinutes = Math.max(0, Math.min(DAY_TOTAL_MINUTES, minuteOfDay(startDate)));
    const endMinutes = Math.max(startMinutes + 5, Math.min(DAY_TOTAL_MINUTES, minuteOfDay(endDate)));
    const startPercent = (startMinutes / DAY_TOTAL_MINUTES) * 100;
    const widthPercent = Math.max(1, ((endMinutes - startMinutes) / DAY_TOTAL_MINUTES) * 100);
    return {
      id: `${block.id}-${index}`,
      startPercent,
      widthPercent
    };
  });

  const navigateDay = (delta: number): void => {
    if (delta === 0) {
      return;
    }
    const nextDirection: "left" | "right" = delta > 0 ? "left" : "right";
    setDayTransitionDirection(nextDirection);
    setDayAnimationKey((current) => current + 1);
    setDayOffset((current) => current + delta);

    if (dayTransitionTimerRef.current !== null) {
      window.clearTimeout(dayTransitionTimerRef.current);
    }
    dayTransitionTimerRef.current = window.setTimeout(() => {
      setDayTransitionDirection(null);
      dayTransitionTimerRef.current = null;
    }, 280);
  };

  const handleScheduleTouchStart = (event: TouchEvent<HTMLElement>): void => {
    if (event.touches.length === 0) {
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    swipeCurrentRef.current = { x: touch.clientX, y: touch.clientY };
    swipeAxisRef.current = null;
  };

  const handleScheduleTouchMove = (event: TouchEvent<HTMLElement>): void => {
    if (event.touches.length === 0 || !swipeStartRef.current) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - swipeStartRef.current.x;
    const deltaY = touch.clientY - swipeStartRef.current.y;

    if (swipeAxisRef.current === null) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
        return;
      }
      swipeAxisRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    }

    swipeCurrentRef.current = { x: touch.clientX, y: touch.clientY };

    if (swipeAxisRef.current === "x") {
      event.preventDefault();
    }
  };

  const resetScheduleSwipe = (): void => {
    swipeStartRef.current = null;
    swipeCurrentRef.current = null;
    swipeAxisRef.current = null;
  };

  const handleScheduleTouchEnd = (): void => {
    if (swipeAxisRef.current === "x" && swipeStartRef.current && swipeCurrentRef.current) {
      const deltaX = swipeCurrentRef.current.x - swipeStartRef.current.x;
      if (Math.abs(deltaX) >= 56) {
        navigateDay(deltaX < 0 ? 1 : -1);
      }
    }
    resetScheduleSwipe();
  };

  // Compute "now" position relative to timeline segments for inline marker
  const nowTime = now.getTime();
  const totalSessionMinutes = dayBlocks.reduce((sum, b) => sum + b.durationMinutes, 0);

  // Find where to insert "now" marker in the timeline
  const nowInsertIndex = isReferenceToday
    ? dayTimeline.findIndex((seg) => seg.start.getTime() > nowTime)
    : -1;
  // If now is past all events, insert at end (length)
  const effectiveNowIndex = isReferenceToday
    ? nowInsertIndex === -1 && dayTimeline.length > 0 && dayTimeline[dayTimeline.length - 1].end.getTime() < nowTime
      ? dayTimeline.length
      : nowInsertIndex
    : -1;

  // Check if "now" falls inside a segment
  const nowInsideSegmentIndex = isReferenceToday
    ? dayTimeline.findIndex((seg) => seg.start.getTime() <= nowTime && seg.end.getTime() > nowTime)
    : -1;

  return (
    <section
      className="schedule-card schedule-card-swipeable"
      onTouchStart={handleScheduleTouchStart}
      onTouchMove={handleScheduleTouchMove}
      onTouchEnd={handleScheduleTouchEnd}
      onTouchCancel={resetScheduleSwipe}
    >
      {/* Compact header with integrated day nav */}
      <div className="sched-header">
        <button type="button" className="sched-nav-btn" onClick={() => navigateDay(-1)} aria-label={t("Previous day")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="sched-header-center">
          <h2 className="sched-title">{scheduleTitle}</h2>
          <span className="sched-date">{scheduleDateLabel}</span>
        </div>
        <button type="button" className="sched-nav-btn" onClick={() => navigateDay(1)} aria-label={t("Next day")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      {/* Meta badges */}
      <div className="sched-badges">
        {dayBlocks.length > 0 ? (
          <span className="sched-chip">
            {dayBlocks.length === 1
              ? t("{count} session", { count: dayBlocks.length })
              : t("{count} sessions", { count: dayBlocks.length })}
          </span>
        ) : (
          <span className="sched-chip sched-chip--empty">{t("Free day")}</span>
        )}
        {totalSessionMinutes > 0 && (
          <span className="sched-chip sched-chip--time">{formatDuration(totalSessionMinutes)}</span>
        )}
        {!isOnline && <span className="sched-chip sched-chip--offline">{t("Offline")}</span>}
      </div>

      <div
        key={dayAnimationKey}
        className={`schedule-day-surface ${
          dayTransitionDirection ? `schedule-day-surface-${dayTransitionDirection}` : ""
        }`}
      >
        {/* Day overview track */}
        <div className="schedule-day-track-wrap">
          <div className="schedule-day-track">
            {isReferenceToday && (
              <span
                className="schedule-day-track-progress"
                style={{ width: `${nowPercent}%` }}
                aria-hidden="true"
              />
            )}
            {DAY_TRACK_TICKS.map((tickHour) => (
              <span
                key={`tick-${tickHour}`}
                className="schedule-day-track-tick"
                style={{ left: `${(tickHour / 24) * 100}%` }}
                aria-hidden="true"
              />
            ))}
            {dayTrackSegments.map((segment) => (
              <span
                key={segment.id}
                className="schedule-day-track-event"
                style={{ left: `${segment.startPercent}%`, width: `${segment.widthPercent}%` }}
                aria-hidden="true"
              />
            ))}
            {isReferenceToday && (
              <span
                className={`schedule-day-track-now${nowNearDayTrackEdge ? " schedule-day-track-now-edge" : ""}`}
                style={{ left: `${nowPercent}%` }}
              >
                <span className="schedule-day-track-now-line" />
                <span className="schedule-day-track-now-label">{nowLabel}</span>
              </span>
            )}
          </div>
          <div className="schedule-day-track-hours">
            {DAY_TRACK_TICKS.map((tickHour) => (
              <span key={`hour-${tickHour}`} className="schedule-day-track-hour">
                {tickHour === 24 ? "24:00" : `${String(tickHour).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="schedule-loading">
            <span className="schedule-loading-dot" />
            <span className="schedule-loading-dot" />
            <span className="schedule-loading-dot" />
          </div>
        ) : dayTimeline.length > 0 ? (
          <div className="tl">
            {dayTimeline.map((segment, index) => {
              const isEvent = segment.type === "event";
              const isActive = isReferenceToday && nowInsideSegmentIndex === index;
              const showNowBefore = effectiveNowIndex === index;
              const timeStart = segment.start.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", hour12: false });
              const timeEnd = segment.end.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", hour12: false });
              const duration = formatDuration(minutesBetween(segment.start, segment.end));
              const label = formatDayTimelineLabel(segment, t);
              const isLast = index === dayTimeline.length - 1;
              const lectureId = isEvent && segment.event ? segment.event.id : undefined;

              return (
                <div key={`${segment.type}-${segment.start.toISOString()}-${index}`}>
                  {/* Now marker inserted between segments */}
                  {showNowBefore && (
                    <div className="tl-now">
                      <span className="tl-now-dot" />
                      <span className="tl-now-line" />
                      <span className="tl-now-label">{t("Now")} {nowLabel}</span>
                    </div>
                  )}

                  {isEvent ? (
                    <div
                      className={`tl-event${isActive ? " tl-event--active" : ""}${focusLectureId && lectureId === focusLectureId ? " tl-event--focused" : ""}`}
                      id={lectureId ? `lecture-${lectureId}` : undefined}
                    >
                      <div className="tl-connector">
                        <span className={`tl-dot${isActive ? " tl-dot--active" : ""}`} />
                        {!isLast && <span className="tl-stem" />}
                      </div>
                      <div className="tl-event-card">
                        <div className="tl-event-time">
                          <span>{timeStart}</span>
                          <span className="tl-event-arrow">→</span>
                          <span>{timeEnd}</span>
                          <span className="tl-event-dur">{duration}</span>
                        </div>
                        <p className="tl-event-title">{label}</p>
                        {isActive && (
                          <span className="tl-event-live">{t("Happening now")}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="tl-gap">
                      <div className="tl-connector">
                        <span className="tl-dot tl-dot--gap" />
                        {!isLast && <span className="tl-stem tl-stem--dashed" />}
                      </div>
                      <div className="tl-gap-body">
                        <span className="tl-gap-time">{timeStart} – {timeEnd}</span>
                        <span className="tl-gap-label">{label}</span>
                        <span className="tl-gap-dur">{duration}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Now marker at end if past all events */}
            {effectiveNowIndex === dayTimeline.length && (
              <div className="tl-now">
                <span className="tl-now-dot" />
                <span className="tl-now-line" />
                <span className="tl-now-label">{t("Now")} {nowLabel}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="schedule-empty-state">
            <span className="schedule-empty-icon">🌤️</span>
            <p>{dayOffset === 0 ? t("No fixed sessions today") : t("No fixed sessions this day")}</p>
            <p className="schedule-empty-hint">{t("Ask Gemini to build your day plan")}</p>
          </div>
        )}
      </div>

    </section>
  );
}
