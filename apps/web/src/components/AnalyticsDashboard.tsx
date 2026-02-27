import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getAnalyticsCoachInsight, getDailyGrowthSummary } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { getVisualCache, putVisualCache, pruneVisualCache } from "../lib/visual-cache";
import { AnalyticsCoachInsight, ChallengePrompt, DailyGrowthSummary } from "../types";
import {
  IconLink, IconCrystalBall, IconThought, IconFist, IconLightbulb,
  IconTarget, IconBrain, IconStrength, IconWarning
} from "./Icons";

type PeriodDays = 1 | 7 | 14 | 30;

const PERIOD_OPTIONS: PeriodDays[] = [1, 7, 14, 30];

function formatGeneratedAt(value: string, localeTag: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(localeTag, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

const CHALLENGE_ICONS: Record<ChallengePrompt["type"], ReactNode> = {
  connect: <IconLink size={16} />,
  predict: <IconCrystalBall size={16} />,
  reflect: <IconThought size={16} />,
  commit: <IconFist size={16} />
};

const CHALLENGE_LABELS: Record<ChallengePrompt["type"], string> = {
  connect: "Connect the dots",
  predict: "Predict",
  reflect: "Reflect",
  commit: "Commit"
};

const CHALLENGE_TYPES: ChallengePrompt["type"][] = ["reflect", "predict", "commit", "connect"];

export function AnalyticsDashboard(): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [periodDays, setPeriodDays] = useState<PeriodDays>(1);
  const [insight, setInsight] = useState<AnalyticsCoachInsight | null>(null);
  const [dailySummary, setDailySummary] = useState<DailyGrowthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsight = useCallback(async (days: PeriodDays, options: { forceRefresh?: boolean } = {}): Promise<void> => {
    setLoading(true);
    setError(null);
    // Clear previous data so skeleton shows during load
    setInsight(null);
    setDailySummary(null);

    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `growth-${days}d-${today}`;

    // Try cached data first (skip if force-refreshing)
    if (!options.forceRefresh) {
      const cached = days === 1
        ? await getVisualCache<DailyGrowthSummary>(cacheKey)
        : await getVisualCache<AnalyticsCoachInsight>(cacheKey);
      if (cached) {
        if (days === 1) { setDailySummary(cached as DailyGrowthSummary); }
        else { setInsight(cached as AnalyticsCoachInsight); }
        setLoading(false);
        return;
      }
    }

    if (days === 1) {
      const next = await getDailyGrowthSummary({ forceRefresh: options.forceRefresh });
      if (!next) {
        setError(t("Could not load daily reflection right now."));
        setLoading(false);
        return;
      }
      setDailySummary(next);
      void putVisualCache(cacheKey, next);
    } else {
      const next = await getAnalyticsCoachInsight(days, options);
      if (!next) {
        setError(t("Could not load narrative analytics right now."));
        setLoading(false);
        return;
      }
      setInsight(next);
      void putVisualCache(cacheKey, next);
    }

    setLoading(false);
  }, [t]);

  useEffect(() => {
    void loadInsight(periodDays);
    void pruneVisualCache();
  }, [periodDays, loadInsight]);

  return (
    <div className="analytics-container">
      <header className="analytics-header">
        <div>
          <h2 className="analytics-title">{periodDays === 1 ? t("Daily Reflection") : t("Narrative Analytics")}</h2>
        </div>

        <div className="analytics-controls">
          <div className="analytics-period-picker" role="tablist" aria-label={t("Analysis period")}>
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === periodDays ? "analytics-period-button active" : "analytics-period-button"}
                onClick={() => setPeriodDays(option)}
                aria-pressed={option === periodDays}
                disabled={loading && option === periodDays}
              >
                {option === 1 ? "1d" : `${option}d`}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {loading && (
        <div className="daily-summary-skeleton analytics-fade-in">
          <div className="skeleton-block skeleton-visual-sm" />
          <div className="skeleton-block skeleton-text-md" />
          <div className="skeleton-block skeleton-text-md" style={{ width: '70%' }} />
          <div className="skeleton-block skeleton-text-sm" style={{ width: '50%' }} />
          <div className="skeleton-row">
            <div className="skeleton-block skeleton-card" />
            <div className="skeleton-block skeleton-card" />
          </div>
        </div>
      )}

      {/* Daily reflection view (1d) */}
      {dailySummary && periodDays === 1 && !loading && (
        <div className="analytics-fade-in">
          {dailySummary.visual && (
            <figure className="analytics-visual">
              <img src={dailySummary.visual.dataUrl} alt={dailySummary.visual.alt} loading="eager" />
            </figure>
          )}
          <section className="analytics-summary-card analytics-summary-hero">
            <div className="analytics-summary-content">
              <p>{dailySummary.summary}</p>
            </div>
            {dailySummary.highlights.length > 0 && (
              <ul className="daily-summary-list">
                {dailySummary.highlights.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            )}
          </section>
          {dailySummary.challenges && dailySummary.challenges.length > 0 && (
            <div className="analytics-swipe-stack">
              {CHALLENGE_TYPES.map((type) => {
                const cards = dailySummary.challenges!.filter((c) => c.type === type);
                if (cards.length === 0) return null;
                return (
                  <div key={type} className="swipeable-card-stack challenge-type-row">
                    {cards.map((c, i) => (
                      <div key={i} className="swipe-card challenge-card">
                        <div className="challenge-header">
                          <span className="challenge-icon">{CHALLENGE_ICONS[type]}</span>
                          <span className="challenge-type">{t(CHALLENGE_LABELS[type])}</span>
                        </div>
                        <p className="challenge-question">{c.question}</p>
                        {c.hint && <p className="challenge-hint"><IconLightbulb size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {c.hint}</p>}
                      </div>
                    ))}
                    {cards.length > 1 && <div className="swipe-indicator">← →</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Multi-day analytics view (7d/14d/30d) */}

      {insight && !loading && (
        <div className="analytics-fade-in">
          <section className="analytics-summary-card analytics-summary-hero">
            {insight.visual && (
              <figure className="analytics-visual">
                <img src={insight.visual.dataUrl} alt={insight.visual.alt} loading="eager" />
              </figure>
            )}
            <div className="analytics-summary-content">
              <div className="analytics-summary-meta">
                <span>{insight.source === "gemini" ? t("Gemini insight") : t("Fallback insight")}</span>
                <span>{formatGeneratedAt(insight.generatedAt, localeTag)}</span>
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
                            <span className="challenge-type">{t(CHALLENGE_LABELS[type])}</span>
                          </div>
                          <p className="challenge-question">{c.question}</p>
                          {c.hint && <p className="challenge-hint"><IconLightbulb size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {c.hint}</p>}
                        </div>
                      ))}
                      <div className="swipe-indicator">← →</div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Insight cards: each category is its own swipeable row */}
            <div className="swipeable-card-stack">
              <div className="swipe-card decorated-card next-steps-card">
                <div className="challenge-header"><span className="challenge-icon"><IconTarget size={16} /></span><span className="challenge-type" style={{color: 'var(--accent)'}}>{t("Next Steps")}</span></div>
                <ol className="analytics-list analytics-list-numbered">
                  {insight.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
              <div className="swipe-card decorated-card coaching-card">
                <div className="challenge-header"><span className="challenge-icon"><IconBrain size={16} /></span><span className="challenge-type" style={{color: '#a78bfa'}}>{t("Coaching")}</span></div>
                <ul className="analytics-list">
                  {insight.correlations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="swipe-card decorated-card strengths-card">
                <div className="challenge-header"><span className="challenge-icon"><IconStrength size={16} /></span><span className="challenge-type" style={{color: '#34d399'}}>{t("Strengths")}</span></div>
                <ul className="analytics-list">
                  {insight.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="swipe-card decorated-card risks-card">
                <div className="challenge-header"><span className="challenge-icon"><IconWarning size={16} /></span><span className="challenge-type" style={{color: 'var(--danger)'}}>{t("Risks")}</span></div>
                <ul className="analytics-list">
                  {insight.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="swipe-indicator">← →</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
