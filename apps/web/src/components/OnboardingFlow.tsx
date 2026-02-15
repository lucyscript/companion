import { useState } from "react";
import { OnboardingProfile } from "../types";

interface OnboardingFlowProps {
  onComplete: (profile: OnboardingProfile) => void;
}

const tones: Array<OnboardingProfile["nudgeTone"]> = ["gentle", "balanced", "direct"];

export function OnboardingFlow({ onComplete }: OnboardingFlowProps): JSX.Element {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [baselineSchedule, setBaselineSchedule] = useState("");
  const [nudgeTone, setNudgeTone] = useState<OnboardingProfile["nudgeTone"]>("balanced");

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();

    if (!name.trim() || !timezone.trim() || !baselineSchedule.trim()) {
      return;
    }

    onComplete({
      name: name.trim(),
      timezone: timezone.trim(),
      baselineSchedule: baselineSchedule.trim(),
      nudgeTone,
      completedAt: new Date().toISOString()
    });
  };

  return (
    <section className="panel onboarding-panel">
      <header className="panel-header">
        <h2>Welcome to Companion</h2>
      </header>
      <p>Let&apos;s set up your profile so nudges fit your daily routine on iPhone.</p>
      <form className="journal-input-form" onSubmit={handleSubmit}>
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
          Start using Companion
        </button>
      </form>
    </section>
  );
}
