import { useCallback, useEffect, useState } from "react";
import { getAnalyticsCoachInsight } from "../lib/api";
import { AnalyticsCoachInsight, ChallengePrompt } from "../types";

type PeriodDays = 7 | 14 | 30;

const PERIOD_OPTIONS: PeriodDays[] = [7, 14, 30];

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

const CHALLENGE_ICONS: Record<ChallengePrompt["type"], string> = {
  connect: "🔗",
  predict: "🔮",
  reflect: "💭",
  commit: "✊"
};

const CHALLENGE_LABELS: Record<ChallengePrompt["type"], string> = {
  connect: "Connect the dots",
  predict: "Predict",
  reflect: "Reflect",
  commit: "Commit"
};

const CHALLENGE_TYPES: ChallengePrompt["type"][] = ["reflect", "predict", "commit", "connect"];

export function AnalyticsDashboard(): JSX.Element {
  const [periodDays, setPeriodDays] = useState<PeriodDays>(14);
  const [insight, setInsight] = useState<AnalyticsCoachInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsight = useCallback(async (days: PeriodDays, options: { forceRefresh?: boolean } = {}): Promise<void> => {
    setLoading(true);
    setError(null);

    const next = await getAnalyticsCoachInsight(days, options);
    if (!next) {
      setError("Could not load narrative analytics right now.");
      setLoading(false);
      return;
    }

    setInsight(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadInsight(periodDays);
  }, [periodDays, loadInsight]);

  return (
    <div className="analytics-container">
      <header className="analytics-header">
        <div>
          <h2 className="analytics-title">Narrative Analytics</h2>
          <p className="analytics-subtitle">Gemini coaching over your recent patterns.</p>
        </div>

        <div className="analytics-controls">
          <div className="analytics-period-picker" role="tablist" aria-label="Analysis period">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === periodDays ? "analytics-period-button active" : "analytics-period-button"}
                onClick={() => setPeriodDays(option)}
                aria-pressed={option === periodDays}
                disabled={loading && option === periodDays}
              >
                {option}d
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {loading && !insight && (
        <div className="daily-summary-skeleton">
          <div className="skeleton-block skeleton-text-lg" />
          <div className="skeleton-block skeleton-text-md" />
          <div className="skeleton-block skeleton-text-md" />
        </div>
      )}

      {insight && (
        <>
          <section className="analytics-summary-card analytics-summary-hero">
            {insight.visual && (
              <figure className="analytics-visual">
                <img src={insight.visual.dataUrl} alt={insight.visual.alt} loading="lazy" />
              </figure>
            )}
            <div className="analytics-summary-content">
              <div className="analytics-summary-meta">
                <span>{insight.source === "gemini" ? "Gemini insight" : "Fallback insight"}</span>
                <span>{formatGeneratedAt(insight.generatedAt)}</span>
              </div>
              <p>{insight.summary}</p>
            </div>
          </section>

          <div className="analytics-swipe-stack">
            {/* Challenge cards grouped by type — each type gets its own swipeable row */}
            {insight.challenges && insight.challenges.length > 0 && (
              <>
                {CHALLENGE_TYPES.map((type) => {
                  const cards = insight.challenges!.filter((c) => c.type === type);
                  if (cards.length === 0) return null;
                  return (
                    <div key={type} className="swipeable-card-stack challenge-type-row">
                      {cards.map((c, i) => (
                        <div key={i} className="swipe-card challenge-card">
                          <div className="challenge-header">
                            <span className="challenge-icon">{CHALLENGE_ICONS[type]}</span>
                            <span className="challenge-type">{CHALLENGE_LABELS[type]}</span>
                          </div>
                          <p className="challenge-question">{c.question}</p>
                          {c.hint && <p className="challenge-hint">💡 {c.hint}</p>}
                        </div>
                      ))}
                      <div className="swipe-indicator">← →</div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Insight cards: each category is its own swipeable row */}
            <div className="swipeable-card-stack decorated-stack">
              <div className="swipe-card decorated-card next-steps-card">
                <h3>Next Steps</h3>
                <ol className="analytics-list analytics-list-numbered">
                  {insight.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
              <div className="swipe-card decorated-card coaching-card">
                <h3>Coaching Observations</h3>
                <ul className="analytics-list">
                  {insight.correlations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="swipe-card decorated-card strengths-card">
                <h3>Strengths</h3>
                <ul className="analytics-list">
                  {insight.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="swipe-card decorated-card risks-card">
                <h3>Risks</h3>
                <ul className="analytics-list">
                  {insight.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="swipe-indicator">← →</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
