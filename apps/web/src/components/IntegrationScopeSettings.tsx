import { useEffect, useMemo, useState } from "react";
import { getCanvasStatus, triggerCanvasSync } from "../lib/api";
import {
  loadIntegrationScopeSettings,
  saveIntegrationScopeSettings
} from "../lib/storage";
import type { CanvasStatus, IntegrationScopeSettings } from "../types";

/** Default time window: 7 days past, 180 days future */
const DEFAULT_PAST_DAYS = 7;
const DEFAULT_FUTURE_DAYS = 180;

export function IntegrationScopeSettings(): JSX.Element {
  const [settings, setSettings] = useState<IntegrationScopeSettings>(loadIntegrationScopeSettings());
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({
    baseUrl: "",
    lastSyncedAt: null,
    courses: []
  });
  const [applyLoading, setApplyLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async (): Promise<void> => {
      const status = await getCanvasStatus();
      setCanvasStatus(status);
    };

    void load();
  }, []);

  const selectedCanvasSet = useMemo(() => new Set(settings.canvasCourseIds), [settings.canvasCourseIds]);

  const updateSettings = (next: IntegrationScopeSettings): void => {
    setSettings(next);
    saveIntegrationScopeSettings(next);
  };

  const toggleCanvasCourse = (courseId: number): void => {
    const nextIds = selectedCanvasSet.has(courseId)
      ? settings.canvasCourseIds.filter((id) => id !== courseId)
      : [...settings.canvasCourseIds, courseId];

    updateSettings({
      ...settings,
      canvasCourseIds: nextIds
    });
  };

  const handleApply = async (): Promise<void> => {
    setApplyLoading(true);
    setError("");
    setMessage("");

    const canvasCourseIds = Array.from(new Set(settings.canvasCourseIds.filter((id) => Number.isInteger(id) && id > 0)));

    const canvasResult = await triggerCanvasSync(undefined, {
      courseIds: canvasCourseIds,
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS
    });

    if (canvasResult.success) {
      setMessage("Canvas synced successfully.");
    } else {
      setError(canvasResult.error ?? "Sync completed with errors.");
    }

    const latestCanvasStatus = await getCanvasStatus();
    setCanvasStatus(latestCanvasStatus);
    setApplyLoading(false);
  };

  return (
    <section className="panel">
      <div className="settings-stack">
        <p className="muted">Select which Canvas courses to track. TP schedule is managed via the iCal connector above.</p>

        <div className="panel">
          <header className="panel-header">
            <h3>Canvas course scope</h3>
            <p className="muted">{settings.canvasCourseIds.length} selected</p>
          </header>

          {canvasStatus.courses.length === 0 ? (
            <p className="muted">No Canvas courses available yet. Connect Canvas above, then sync.</p>
          ) : (
            <>
              <div className="panel-header">
                <button
                  type="button"
                  onClick={() => updateSettings({ ...settings, canvasCourseIds: canvasStatus.courses.map((course) => course.id) })}
                >
                  Select all
                </button>
                <button type="button" onClick={() => updateSettings({ ...settings, canvasCourseIds: [] })}>
                  Clear
                </button>
              </div>
              <ul className="list">
                {canvasStatus.courses.map((course) => (
                  <li key={course.id} className="list-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedCanvasSet.has(course.id)}
                        onChange={() => toggleCanvasCourse(course.id)}
                      />
                      {" "}
                      {course.course_code} - {course.name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <button type="button" className="settings-push-btn" onClick={() => void handleApply()} disabled={applyLoading || canvasStatus.courses.length === 0} style={{ alignSelf: "flex-start" }}>
          {applyLoading ? "Syncing..." : "Sync now"}
        </button>

        {message && <p className="muted">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
