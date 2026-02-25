import { useCallback, useEffect, useState } from "react";
import {
  createStripeCheckout,
  createVippsAgreement,
  getPlanTiers,
  getStripeStatus,
  getVippsStatus,
  getUserPlan,
  startTrial
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { ConnectorService, FeatureId, PlanId, PlanTierSummary, UserPlanInfo } from "../types";

type PaymentMethod = "vipps" | "stripe";

interface UpgradePromptProps {
  feature?: string;
  onDismiss: () => void;
}

export function UpgradePrompt({ feature, onDismiss }: UpgradePromptProps): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [tiers, setTiers] = useState<PlanTierSummary[]>([]);
  const [planInfo, setPlanInfo] = useState<UserPlanInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [stripePrices, setStripePrices] = useState<{ plus: boolean; pro: boolean }>({ plus: false, pro: false });
  const [vippsReady, setVippsReady] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>("vipps");

  useEffect(() => {
    void getPlanTiers().then(setTiers).catch(() => {});
    void getUserPlan().then(setPlanInfo).catch(() => {});
    void getStripeStatus().then((s) => {
      setStripeReady(s.configured);
      setStripePrices(s.prices);
    }).catch(() => {});
    void getVippsStatus().then((v) => {
      setVippsReady(v.configured);
      // Default to Vipps if available, otherwise Stripe
      if (v.configured) setSelectedPayment("vipps");
    }).catch(() => {});
  }, []);

  const handleStartTrial = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const updated = await startTrial();
      setPlanInfo(updated);
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("Failed to start trial");
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        setError(parsed.error ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setStarting(false);
    }
  }, [t]);

  const handleStripeCheckout = useCallback(async (plan: PlanId) => {
    setStarting(true);
    setError(null);
    try {
      const result = await createStripeCheckout(plan);
      window.location.href = result.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("Failed to start checkout");
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        setError(parsed.error ?? msg);
      } catch {
        setError(msg);
      }
      setStarting(false);
    }
  }, []);

  const handleVippsCheckout = useCallback(async (plan: PlanId) => {
    setStarting(true);
    setError(null);
    try {
      const result = await createVippsAgreement(plan);
      // Redirect user to Vipps to approve the agreement
      window.location.href = result.redirectUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("Failed to start Vipps payment");
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        setError(parsed.error ?? msg);
      } catch {
        setError(msg);
      }
      setStarting(false);
    }
  }, [t]);

  const handlePayment = useCallback(async (plan: PlanId) => {
    if (selectedPayment === "vipps" && vippsReady) {
      return handleVippsCheckout(plan);
    }
    if (selectedPayment === "stripe" && stripeReady) {
      return handleStripeCheckout(plan);
    }
  }, [selectedPayment, vippsReady, stripeReady, handleVippsCheckout, handleStripeCheckout]);

  const hasPaymentMethod = vippsReady || (stripeReady && stripePrices.plus);

  const paidTiers = tiers.filter((t) => t.priceMonthlyNok > 0);
  const canTrial = planInfo?.plan === "free" && !planInfo?.trialEndsAt;

  return (
    <div className="upgrade-overlay" onClick={onDismiss}>
      <div className="upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <button className="upgrade-close" onClick={onDismiss} aria-label={t("Close")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="upgrade-header">
          <span className="upgrade-icon">✨</span>
          <h2 className="upgrade-title">{t("Upgrade to unlock")}</h2>
          {feature && <p className="upgrade-feature-label">{t("{feature} requires a paid plan", { feature })}</p>}
        </div>

        {planInfo && (
          <div className="upgrade-current-plan">
            <span className={`plan-badge plan-badge-${planInfo.plan}`}>{planInfo.badge}</span>
            <span className="upgrade-current-label">{t("Current plan")}</span>
            {planInfo.isTrial && planInfo.trialEndsAt && (
              <span className="upgrade-trial-label">
                {t("Trial ends {date}", { date: new Date(planInfo.trialEndsAt).toLocaleDateString(localeTag) })}
              </span>
            )}
          </div>
        )}

        <div className="upgrade-tiers">
          {paidTiers.map((tier) => (
            <div
              key={tier.id}
              className={`upgrade-tier-card ${planInfo?.plan === tier.id ? "upgrade-tier-current" : ""}`}
            >
              <div className="upgrade-tier-header">
                <span className={`plan-badge plan-badge-${tier.id}`}>{tier.badge}</span>
                <span className="upgrade-tier-price">
                  {tier.priceMonthlyNok} kr<span className="upgrade-tier-period">/mo</span>
                </span>
              </div>
              <p className="upgrade-tier-desc">{tier.description}</p>
              <ul className="upgrade-tier-features">
                <li>{tier.dailyChatLimit === 0 ? t("Unlimited") : tier.dailyChatLimit} {t("AI messages/day")}</li>
                <li>{tier.maxChatHistory === 0 ? t("Unlimited") : tier.maxChatHistory} {t("chat history")}</li>
                <li>{tier.connectors.length} {t("integrations")}</li>
                {tier.features.includes("nutrition" as FeatureId) && <li>{t("Nutrition tracking")}</li>}
                {tier.features.includes("gemini_tools" as FeatureId) && !tier.features.includes("analytics" as FeatureId) && <li>{t("AI tools & search")}</li>}
                {tier.features.includes("habits" as FeatureId) && <li>{t("Growth & habits")}</li>}
                {tier.features.includes("analytics" as FeatureId) && <li>{t("Analytics dashboard")}</li>}
                {tier.features.includes("custom_moods" as FeatureId) && <li>{t("Custom chat themes")}</li>}
                {tier.connectors.includes("withings" as ConnectorService) && <li>{t("Withings health sync")}</li>}
                {tier.trialDays > 0 && <li>{t("{days}-day free trial", { days: tier.trialDays })}</li>}
              </ul>
              {planInfo?.plan === tier.id ? (
                <div className="upgrade-tier-active">{t("Current plan")}</div>
              ) : (
                <button
                  className="upgrade-tier-btn"
                  onClick={() => {
                    if (canTrial && tier.id === "plus") {
                      void handleStartTrial();
                    } else if (hasPaymentMethod) {
                      void handlePayment(tier.id as PlanId);
                    }
                  }}
                  disabled={starting || (!canTrial && !hasPaymentMethod)}
                >
                  {starting
                    ? t("Processing...")
                    : canTrial && tier.id === "plus"
                      ? t("Start {days}-day free trial", { days: tier.trialDays })
                      : hasPaymentMethod
                        ? t("Subscribe — {price} kr/mo", { price: tier.priceMonthlyNok })
                        : t("Coming soon")}
                </button>
              )}
            </div>
          ))}
        </div>

        {error && <p className="upgrade-error">{error}</p>}

        {/* Payment method selector — show when both Vipps and Stripe are available */}
        {vippsReady && stripeReady && !canTrial && (
          <div className="payment-method-selector">
            <span className="payment-method-label">{t("Pay with:")}</span>
            <button
              className={`payment-method-btn ${selectedPayment === "vipps" ? "payment-method-active" : ""}`}
              onClick={() => setSelectedPayment("vipps")}
            >
              Vipps
            </button>
            <button
              className={`payment-method-btn ${selectedPayment === "stripe" ? "payment-method-active" : ""}`}
              onClick={() => setSelectedPayment("stripe")}
            >
              {t("Card")}
            </button>
          </div>
        )}

        <p className="upgrade-footer">
          {canTrial
            ? t("Start your free trial — cancel anytime within 7 days.")
            : vippsReady && selectedPayment === "vipps"
              ? t("Pay easily with Vipps MobilePay. Cancel anytime.")
              : stripeReady
                ? t("Secure checkout powered by Stripe. Cancel anytime.")
                : t("Payment integration coming soon.")}
        </p>
      </div>
    </div>
  );
}

interface LockedFeatureOverlayProps {
  featureName: string;
  onUpgradeClick: () => void;
}

export function LockedFeatureOverlay({ featureName, onUpgradeClick }: LockedFeatureOverlayProps): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="locked-feature-overlay">
      <div className="locked-feature-content">
        <div className="locked-feature-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h3 className="locked-feature-title">{featureName}</h3>
        <p className="locked-feature-desc">{t("This feature is available on paid plans.")}</p>
        <button className="locked-feature-btn" onClick={onUpgradeClick}>
          <span>✨</span> {t("Upgrade to unlock")}
        </button>
      </div>
    </div>
  );
}
