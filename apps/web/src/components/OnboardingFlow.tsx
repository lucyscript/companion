import { useState } from "react";
import { OnboardingProfile } from "../types";

interface OnboardingFlowProps {
  onComplete: (profile: OnboardingProfile) => void;
}

const tones: Array<OnboardingProfile["nudgeTone"]> = ["gentle", "balanced", "direct"];

type OnboardingStep = "profile" | "canvas" | "tp" | "complete";

export function OnboardingFlow({ onComplete }: OnboardingFlowProps): JSX.Element {
  const [step, setStep] = useState<OnboardingStep>("profile");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [baselineSchedule, setBaselineSchedule] = useState("");
  const [nudgeTone, setNudgeTone] = useState<OnboardingProfile["nudgeTone"]>("balanced");
  const [canvasToken, setCanvasToken] = useState("");
  const [tpSemester, setTpSemester] = useState("26v");
  const [tpCourseIds, setTpCourseIds] = useState("DAT520,1;DAT560,1;DAT600,1");

  const handleProfileSubmit = (event: React.FormEvent): void => {
    event.preventDefault();

    if (!name.trim() || !timezone.trim() || !baselineSchedule.trim()) {
      return;
    }

    setStep("canvas");
  };

  const handleCanvasSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setStep("tp");
  };

  const handleCanvasSkip = (): void => {
    setCanvasToken("");
    setStep("tp");
  };

  const handleTpSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    completeOnboarding();
  };

  const handleTpSkip = (): void => {
    setTpCourseIds("");
    completeOnboarding();
  };

  const completeOnboarding = (): void => {
    const profile: OnboardingProfile = {
      name: name.trim(),
      timezone: timezone.trim(),
      baselineSchedule: baselineSchedule.trim(),
      nudgeTone,
      completedAt: new Date().toISOString()
    };

    if (canvasToken.trim()) {
      profile.canvasToken = canvasToken.trim();
    }

    if (tpCourseIds.trim() && tpSemester.trim()) {
      profile.tpCredentials = {
        courseIds: tpCourseIds.split(";").map(id => id.trim()).filter(Boolean),
        semester: tpSemester.trim()
      };
    }

    onComplete(profile);
  };

  if (step === "profile") {
    return (
      <section className="panel onboarding-panel">
        <header className="panel-header">
          <h2>Welcome to Companion</h2>
        </header>
        <p>Let&apos;s set up your profile so nudges fit your daily routine on iPhone.</p>
        <form className="journal-input-form" onSubmit={handleProfileSubmit}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Lucy" />
          </label>

          <label>
            Timezone
            <input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Copenhagen"
            />
          </label>

          <label>
            Baseline schedule
            <textarea
              value={baselineSchedule}
              onChange={(event) => setBaselineSchedule(event.target.value)}
              rows={3}
              placeholder="Classes Mon–Fri 9-15, gym Tue/Thu 17:00"
            />
          </label>

          <label>
            Preferred nudge tone
            <select value={nudgeTone} onChange={(event) => setNudgeTone(event.target.value as OnboardingProfile["nudgeTone"])}>
              {tones.map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={!name.trim() || !timezone.trim() || !baselineSchedule.trim()}>
            Continue
          </button>
        </form>
      </section>
    );
  }

  if (step === "canvas") {
    return (
      <section className="panel onboarding-panel">
        <header className="panel-header">
          <h2>Connect Canvas LMS</h2>
        </header>
        <div className="onboarding-info">
          <p><strong>What data is synced:</strong></p>
          <ul>
            <li>Course names and codes</li>
            <li>Assignment deadlines and descriptions</li>
            <li>Grades and submission status</li>
            <li>Course announcements</li>
          </ul>
          <p><strong>Privacy:</strong> Your Canvas token is stored locally on your device only. It is never sent to third-party servers. The app uses it to fetch your Canvas data directly from stavanger.instructure.com.</p>
        </div>
        <form className="journal-input-form" onSubmit={handleCanvasSubmit}>
          <label>
            Canvas access token
            <input
              type="password"
              value={canvasToken}
              onChange={(event) => setCanvasToken(event.target.value)}
              placeholder="Paste your Canvas API token"
            />
            <small className="muted">Get your token from Canvas Account → Settings → New Access Token</small>
          </label>

          <div className="button-group">
            <button type="button" onClick={handleCanvasSkip} className="button-secondary">
              Skip for now
            </button>
            <button type="submit" disabled={!canvasToken.trim()}>
              Continue
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (step === "tp") {
    return (
      <section className="panel onboarding-panel">
        <header className="panel-header">
          <h2>Connect TP EduCloud</h2>
        </header>
        <div className="onboarding-info">
          <p><strong>What data is synced:</strong></p>
          <ul>
            <li>Lecture schedule with times and locations</li>
            <li>Lab sessions and guidance hours</li>
            <li>Exam dates</li>
          </ul>
          <p><strong>Privacy:</strong> TP EduCloud provides a public iCal feed — no authentication required. The app fetches your course schedule directly from tp.educloud.no. Your course selections are stored locally only.</p>
        </div>
        <form className="journal-input-form" onSubmit={handleTpSubmit}>
          <label>
            Semester
            <input
              value={tpSemester}
              onChange={(event) => setTpSemester(event.target.value)}
              placeholder="26v"
            />
            <small className="muted">Format: YY[v|h] (e.g., 26v for Spring 2026, 26h for Fall 2026)</small>
          </label>

          <label>
            Course IDs
            <input
              value={tpCourseIds}
              onChange={(event) => setTpCourseIds(event.target.value)}
              placeholder="DAT520,1;DAT560,1;DAT600,1"
            />
            <small className="muted">Semicolon-separated list (e.g., DAT520,1;DAT560,1)</small>
          </label>

          <div className="button-group">
            <button type="button" onClick={handleTpSkip} className="button-secondary">
              Skip for now
            </button>
            <button type="submit" disabled={!tpSemester.trim() || !tpCourseIds.trim()}>
              Complete setup
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="panel onboarding-panel">
      <header className="panel-header">
        <h2>Setup Complete</h2>
      </header>
      <p>Redirecting...</p>
    </section>
  );
}
