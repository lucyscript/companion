import { useState } from "react";
import { submitJournalEntry } from "../lib/api";
import { Priority } from "../types";

interface FloatingQuickCaptureProps {
  onUpdated?: () => Promise<void>;
}

type CaptureMode = "journal" | "deadline";

export function FloatingQuickCapture({ onUpdated }: FloatingQuickCaptureProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>("journal");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  // Deadline-specific fields
  const [course, setCourse] = useState("");
  const [task, setTask] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");

  const resetForm = (): void => {
    setContent("");
    setCourse("");
    setTask("");
    setDueDate("");
    setPriority("medium");
    setMessage("");
  };

  const handleSubmit = async (): Promise<void> => {
    if (mode === "journal") {
      if (!content.trim()) {
        setMessage("Please enter some content");
        return;
      }

      setSubmitting(true);
      setMessage("");

      const clientEntryId = `quick-${Date.now()}`;
      const entry = await submitJournalEntry(content, clientEntryId);

      setSubmitting(false);

      if (entry) {
        setMessage("Journal entry saved!");
        resetForm();
        setTimeout(() => {
          setIsOpen(false);
          setMessage("");
        }, 1000);
        if (onUpdated) {
          await onUpdated();
        }
      } else {
        setMessage("Failed to save. Entry queued for sync.");
      }
    } else {
      // Deadline mode
      if (!course.trim() || !task.trim() || !dueDate) {
        setMessage("Please fill in all deadline fields");
        return;
      }

      setSubmitting(true);
      setMessage("");

      try {
        const response = await fetch("/api/deadlines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course: course.trim(),
            task: task.trim(),
            dueDate,
            priority
          })
        });

        setSubmitting(false);

        if (response.ok) {
          setMessage("Deadline created!");
          resetForm();
          setTimeout(() => {
            setIsOpen(false);
            setMessage("");
          }, 1000);
          if (onUpdated) {
            await onUpdated();
          }
        } else {
          const body = await response.text();
          setMessage(`Failed: ${body}`);
        }
      } catch (error) {
        setSubmitting(false);
        setMessage(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      setIsOpen(false);
      resetForm();
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        className="floating-quick-capture-btn"
        onClick={() => setIsOpen(true)}
        aria-label="Quick capture"
        title="Quick capture (journal or deadline)"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    );
  }

  return (
    <>
      <div className="floating-quick-capture-overlay" onClick={() => setIsOpen(false)} />
      <div className="floating-quick-capture-modal" onKeyDown={handleKeyDown}>
        <div className="quick-capture-header">
          <h3>Quick Capture</h3>
          <button
            type="button"
            className="quick-capture-close"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="quick-capture-mode-tabs">
          <button
            type="button"
            className={mode === "journal" ? "active" : ""}
            onClick={() => {
              setMode("journal");
              resetForm();
            }}
          >
            Journal
          </button>
          <button
            type="button"
            className={mode === "deadline" ? "active" : ""}
            onClick={() => {
              setMode("deadline");
              resetForm();
            }}
          >
            Deadline
          </button>
        </div>

        <div className="quick-capture-content">
          {mode === "journal" ? (
            <textarea
              className="quick-capture-textarea"
              placeholder="What's on your mind?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              autoFocus
              rows={6}
            />
          ) : (
            <div className="quick-capture-deadline-form">
              <input
                type="text"
                placeholder="Course"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                autoFocus
              />
              <input
                type="text"
                placeholder="Task"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
                <option value="critical">Critical Priority</option>
              </select>
            </div>
          )}

          {message && <div className="quick-capture-message">{message}</div>}
        </div>

        <div className="quick-capture-actions">
          <button type="button" onClick={() => setIsOpen(false)} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="quick-capture-submit"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? "Saving..." : mode === "journal" ? "Save Entry" : "Create Deadline"}
          </button>
        </div>
      </div>
    </>
  );
}
