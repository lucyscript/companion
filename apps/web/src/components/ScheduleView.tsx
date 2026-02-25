import { useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";
import { getSchedule } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { LectureEvent } from "../types";
import { IconSunPartial } from "./Icons";

interface DayTimelineSegment {
  type: "event" | "free";
  start: Date;
  end: Date;
  event?: LectureEvent;
}

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
    .trim()
    .replace(/^[\/\s]+|[\/\s]+$/g, "")
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

function formatDayTimelineLabel(
  segment: DayTimelineSegment,
  t: (text: string, vars?: Record<string, string | number>) => string
): string {
  if (segment.type === "free") {
    return t("Free");
  }

  const title = formatLectureTitle(segment.event?.title ?? t("Scheduled block"));
  const roomLabel = formatRoomLabel(segment.event?.location);
  return roomLabel ? `${title} • ${roomLabel}` : title;
}

function buildDayTimeline(
  scheduleBlocks: LectureEvent[],
  referenceDate: Date
): DayTimelineSegment[] {
  const sorted = [...scheduleBlocks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (sorted.length === 0) {
    return [];
  }

  // Timeline starts 1h before first event (clamped to 00:00)
  const firstStart = new Date(sorted[0].startTime);
  const timelineStart = new Date(referenceDate);
  timelineStart.setHours(Math.max(0, firstStart.getHours() - 1), 0, 0, 0);

  // Timeline ends 1h after last event (clamped to 23:59)
  const lastLecture = sorted[sorted.length - 1];
  const lastEnd = new Date(new Date(lastLecture.startTime).getTime() + lastLecture.durationMinutes * 60000);
  const timelineEnd = new Date(referenceDate);
  timelineEnd.setHours(Math.min(23, lastEnd.getHours() + 1), lastEnd.getHours() + 1 > 23 ? 59 : 0, 0, 0);

  const segments: DayTimelineSegment[] = [];
  let cursor = timelineStart;

  sorted.forEach((lecture) => {
    const start = new Date(lecture.startTime);
    const end = new Date(start.getTime() + lecture.durationMinutes * 60000);

    const gapMinutes = minutesBetween(cursor, start);
    if (gapMinutes >= 30) {
      segments.push({
        type: "free",
        start: new Date(cursor),
        end: new Date(start)
      });
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
  if (trailingGap >= 30) {
    segments.push({
      type: "free",
      start: new Date(cursor),
      end: new Date(timelineEnd)
    });
  }

  return segments;
}

interface ScheduleViewProps {
  focusLectureId?: string;
}

export function ScheduleView({ focusLectureId }: ScheduleViewProps): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [schedule, setSchedule] = useState<LectureEvent[]>([]);
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
        const nextSchedule = await getSchedule();
        if (!disposed) {
          setSchedule(nextSchedule);
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
  const dayBlocks = sortedSchedule.filter((block) => isSameLocalDate(new Date(block.startTime), referenceDate));
  const dayTimeline = dayBlocks.length > 0
    ? buildDayTimeline(dayBlocks, referenceDate)
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
  const nowLabel = now.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", hour12: false });

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
            <span className="schedule-empty-icon"><IconSunPartial size={32} /></span>
            <p>{dayOffset === 0 ? t("No fixed sessions today") : t("No fixed sessions this day")}</p>
            <p className="schedule-empty-hint">{t("Ask Gemini to build your day plan")}</p>
          </div>
        )}
      </div>

    </section>
  );
}
