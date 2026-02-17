import { ScheduleView } from "./ScheduleView";
import { DeadlineList } from "./DeadlineList";

interface ScheduleTabProps {
  scheduleKey: string;
  focusDeadlineId?: string;
  focusLectureId?: string;
}

export function ScheduleTab({ scheduleKey, focusDeadlineId, focusLectureId }: ScheduleTabProps): JSX.Element {
  return (
    <div className="schedule-tab-container">
      <div className="schedule-grid">
        <ScheduleView key={scheduleKey} focusLectureId={focusLectureId} />
        <DeadlineList key={`deadline-${scheduleKey}`} focusDeadlineId={focusDeadlineId} />
      </div>
    </div>
  );
}
