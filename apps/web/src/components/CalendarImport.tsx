import { useState } from "react";
import { applyCalendarImport, previewCalendarImport } from "../lib/api";
import { CalendarImportPreview, CalendarImportResult } from "../types";

type ImportMode = "ics" | "url";

interface CalendarImportProps {
  onApply: (lectures: CalendarImportResult["lectures"], deadlines: CalendarImportResult["deadlines"]) => void;
}

export function CalendarImport({ onApply }: CalendarImportProps): JSX.Element {
  const [mode, setMode] = useState<ImportMode>("ics");
  const [ics, setIcs] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const payload = mode === "ics" ? { ics: ics.trim() } : { url: url.trim() };
  const hasInput = mode === "ics" ? Boolean(ics.trim()) : Boolean(url.trim());

  const resetStatus = (): void => {
    setMessage("");
    setError("");
  };

  const handleModeChange = (next: ImportMode): void => {
    setMode(next);
    setPreview(null);
    resetStatus();
  };

  const handlePreview = async (): Promise<void> => {
    resetStatus();
    if (!hasInput) {
      setError(mode === "ics" ? "Paste ICS calendar text to preview." : "Enter an ICS URL to preview.");
      setPreview(null);
      return;
    }

    setPreviewing(true);
    try {
      const result = await previewCalendarImport(payload);
      setPreview(result);
      setMessage(
        `Found ${result.importedEvents} events (${result.lecturesPlanned} lectures, ${result.deadlinesPlanned} deadlines).`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unable to preview calendar import.";
      setError(reason);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    resetStatus();
    if (!hasInput) {
      setError(mode === "ics" ? "Paste ICS calendar text to apply." : "Enter an ICS URL to apply.");
      return;
    }

    setApplying(true);
    try {
      const result = await applyCalendarImport(payload);
      onApply(result.lectures, result.deadlines);
      setMessage(
        `Imported ${result.importedEvents} events (${result.lecturesCreated} lectures, ${result.deadlinesCreated} deadlines).`
      );
      setPreview({
        importedEvents: result.importedEvents,
        lecturesPlanned: result.lecturesCreated,
        deadlinesPlanned: result.deadlinesCreated,
        lectures: result.lectures.map(({ id, ...rest }) => rest),
        deadlines: result.deadlines.map(({ id, ...rest }) => rest)
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unable to apply calendar import.";
      setError(reason);
    } finally {
      setApplying(false);
    }
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };

  return (
    <section className="panel import-panel">
      <header className="panel-header">
        <h2>Calendar import</h2>
        {preview && <span className="import-count">{preview.importedEvents} events</span>}
      </header>

      {message && <p className="import-message">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="import-mode">
        <label>
          <input
            type="radio"
            name="import-mode"
            value="ics"
            checked={mode === "ics"}
            onChange={() => handleModeChange("ics")}
          />
          Paste ICS text
        </label>
        <label>
          <input
            type="radio"
            name="import-mode"
            value="url"
            checked={mode === "url"}
            onChange={() => handleModeChange("url")}
          />
          ICS URL
        </label>
      </div>

      <div className="import-inputs">
        {mode === "ics" ? (
          <label>
            ICS content
            <textarea
              className="journal-textarea"
              placeholder="Paste the full ICS text here..."
              value={ics}
              onChange={(event) => setIcs(event.target.value)}
              rows={6}
            />
          </label>
        ) : (
          <label>
            ICS URL
            <input
              type="url"
              placeholder="https://example.edu/calendar.ics"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
        )}
      </div>

      <div className="import-actions">
        <button type="button" onClick={() => void handlePreview()} disabled={previewing || applying}>
          {previewing ? "Previewing..." : "Preview import"}
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={applying || previewing || !preview}
        >
          {applying ? "Importing..." : "Apply import"}
        </button>
      </div>

      {preview && (
        <div className="import-preview">
          <div className="import-summary">
            <div>
              <p className="summary-label">Lectures</p>
              <p className="summary-value">{preview.lecturesPlanned}</p>
            </div>
            <div>
              <p className="summary-label">Deadlines</p>
              <p className="summary-value">{preview.deadlinesPlanned}</p>
            </div>
          </div>

          {preview.lectures.length > 0 && (
            <div>
              <h3 className="preview-heading">Lectures to add</h3>
              <ul className="import-list">
                {preview.lectures.map((lecture, index) => (
                  <li key={`${lecture.title}-${index}`} className="import-list-item">
                    <div className="import-list-row">
                      <span className="import-title">{lecture.title}</span>
                      <span className={`workload workload-${lecture.workload}`}>{lecture.workload}</span>
                    </div>
                    <div className="import-list-meta">
                      <span>{formatDate(lecture.startTime)}</span>
                      <span className="schedule-separator">•</span>
                      <span>{lecture.durationMinutes} min</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.deadlines.length > 0 && (
            <div>
              <h3 className="preview-heading">Deadlines to add</h3>
              <ul className="import-list">
                {preview.deadlines.map((deadline, index) => (
                  <li key={`${deadline.task}-${index}`} className="import-list-item">
                    <div className="import-list-row">
                      <span className="import-title">{deadline.task}</span>
                      <span className={`priority-chip priority-${deadline.priority}`}>{deadline.priority}</span>
                    </div>
                    <div className="import-list-meta">
                      <span>{deadline.course}</span>
                      <span className="schedule-separator">•</span>
                      <span>{formatDate(deadline.dueDate)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.lectures.length === 0 && preview.deadlines.length === 0 && (
            <p className="import-empty">No events detected in the ICS data.</p>
          )}
        </div>
      )}
    </section>
  );
}
