import { useEffect, useState } from "react";
import { getConnectors } from "../lib/api";
import { ScheduleView } from "./ScheduleView";
import { DeadlineList } from "./DeadlineList";
import { RemindersWidget } from "./RemindersWidget";

interface ScheduleTabProps {
  scheduleKey: string;
  focusDeadlineId?: string;
  focusLectureId?: string;
}

const SCHEDULE_SERVICES = new Set(["canvas", "tp_schedule", "timeedit"]);
const DEADLINE_SERVICES = new Set(["canvas", "blackboard"]);

export function ScheduleTab({ scheduleKey, focusDeadlineId, focusLectureId }: ScheduleTabProps): JSX.Element {
  const [hasScheduleIntegration, setHasScheduleIntegration] = useState(false);
  const [hasDeadlineIntegration, setHasDeadlineIntegration] = useState(false);

  useEffect(() => {
    void getConnectors().then((connections) => {
      setHasScheduleIntegration(connections.some((c) => SCHEDULE_SERVICES.has(c.service)));
      setHasDeadlineIntegration(connections.some((c) => DEADLINE_SERVICES.has(c.service)));
    }).catch(() => { /* ignore */ });
  }, []);

  return (
    <div className="schedule-tab-container">
      <div className="schedule-grid">
        <ScheduleView key={scheduleKey} focusLectureId={focusLectureId} hasScheduleIntegration={hasScheduleIntegration} />
        <DeadlineList key={`deadline-${scheduleKey}`} focusDeadlineId={focusDeadlineId} hasDeadlineIntegration={hasDeadlineIntegration} />
      </div>
      <RemindersWidget key={`reminders-${scheduleKey}`} />
    </div>
  );
}
