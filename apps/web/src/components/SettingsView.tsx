import { useState } from "react";
import { NotificationSettings } from "./NotificationSettings";
import { IntegrationScopeSettings } from "./IntegrationScopeSettings";
import { ConnectorsView } from "./ConnectorsView";
import { deleteAllUserData } from "../lib/api";
import { clearCompanionSessionData } from "../lib/storage";
import { useI18n } from "../lib/i18n";
import { THEME_OPTIONS } from "../lib/theme";
import type { ThemePreference, UserPlanInfo } from "../types";
import {
  IconGear, IconDiamond, IconSparkles, IconPalette, IconLink, IconGlobe,
  IconTarget, IconBell, IconShield, IconTrash, IconWarning, IconCircleFilled
} from "./Icons";

interface SettingsViewProps {
  planInfo: UserPlanInfo | null;
  onUpgrade: () => void;
  themePreference: ThemePreference;
  themesLocked: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  /** Currently signed-in user email (null if auth not required) */
  userEmail: string | null;
  /** Whether auth is required (shows account section) */
  authRequired: boolean;
  /** Sign out handler */
  onSignOut: () => void;
  /** Whether sign out is in progress */
  signingOut: boolean;
  /** Push notification state */
  pushState: "checking" | "enabled" | "idle" | "unsupported" | "ready" | "denied" | "error";
  /** Handler to enable push notifications */
  onEnablePush: () => void;
  /** Push status message */
  pushMessage: string;
}

export function SettingsView({
  planInfo,
  onUpgrade,
  themePreference,
  themesLocked,
  onThemeChange,
  userEmail,
  authRequired,
  onSignOut,
  signingOut,
  pushState,
  onEnablePush,
  pushMessage,
}: SettingsViewProps): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const pushButtonDisabled =
    pushState === "checking" || pushState === "enabled" || pushState === "unsupported" || pushState === "denied" || pushState === "error";

  const [deleteConfirmStep, setDeleteConfirmStep] = useState<0 | 1 | 2>(0);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async (): Promise<void> => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteAllUserData();
      clearCompanionSessionData({ keepTheme: false });
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t("Deletion failed. Please try again."));
      setDeleteLoading(false);
    }
  };

  return (
    <div className="settings-container">
      {/* Account section */}
      {authRequired && (
        <div className="settings-account-bar">
          <div className="settings-account-info">
            {userEmail && (
              <p className="settings-account-email">{t("Signed in as")} <strong>{userEmail}</strong></p>
            )}
          </div>
          <button
            type="button"
            className="settings-sign-out-btn"
            onClick={onSignOut}
            disabled={signingOut}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {signingOut ? t("Signing out…") : t("Sign out")}
          </button>
        </div>
      )}

      <div className="settings-header">
        <span className="settings-header-icon"><IconGear size={20} /></span>
        <h2>{t("Settings")}</h2>
      </div>

      {/* Plan & Usage section */}
      {planInfo && (
        <div className="settings-section">
          <h3 className="settings-section-title"><IconDiamond size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Your Plan")}</h3>
          <div className="plan-info-card">
            <div className="plan-info-row">
              <span className={`plan-badge plan-badge-${planInfo.plan}`}>{planInfo.badge}</span>
              {planInfo.planName !== planInfo.badge && (
                <span className="plan-info-name">{planInfo.planName}</span>
              )}
              {planInfo.isTrial && planInfo.trialEndsAt && (
                <span className="plan-trial-badge">
                  {t("Trial · ends {date}", { date: new Date(planInfo.trialEndsAt).toLocaleDateString(localeTag) })}
                </span>
              )}
            </div>
            <div className="plan-usage-row">
              <span className="plan-usage-label">{t("AI messages today")}</span>
              <span className="plan-usage-value">
                {planInfo.chatUsedToday} / {planInfo.chatLimitToday === 0 ? "∞" : planInfo.chatLimitToday}
              </span>
            </div>
            {planInfo.chatLimitToday > 0 && (
              <div className="plan-usage-bar-track">
                <div
                  className="plan-usage-bar-fill"
                  style={{ width: `${Math.min(100, (planInfo.chatUsedToday / planInfo.chatLimitToday) * 100)}%` }}
                />
              </div>
            )}
            {planInfo.plan === "free" && (
              <button className="plan-upgrade-btn" onClick={onUpgrade}>
                <IconSparkles size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Upgrade plan")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="settings-section">
        <h3 className="settings-section-title"><IconPalette size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Appearance")}</h3>
        <div className="settings-theme-card">
          <p className="settings-theme-info">
            {themesLocked
              ? t("Custom themes are available on paid plans.")
              : t("Choose a visual theme that applies across the app, including chat.")}
          </p>
          <div className="settings-theme-grid">
            {THEME_OPTIONS.map((theme) => {
              const selected = themePreference === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`settings-theme-option ${selected ? "settings-theme-option-active" : ""}`}
                  onClick={() => onThemeChange(theme.id)}
                  disabled={themesLocked}
                  aria-pressed={selected}
                >
                  <span className="settings-theme-swatches" aria-hidden="true">
                    {theme.preview.map((color) => (
                      <span key={color} className="settings-theme-swatch" style={{ background: color }} />
                    ))}
                  </span>
                  <span className="settings-theme-text">
                    <span className="settings-theme-label">{theme.label}</span>
                    <span className="settings-theme-desc">{theme.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {themesLocked && (
            <button type="button" className="settings-theme-upgrade-btn" onClick={onUpgrade}>
              {t("Upgrade to unlock themes")}
            </button>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title"><IconLink size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Integrations")}</h3>
        <ConnectorsView planInfo={planInfo} onUpgrade={onUpgrade} />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title"><IconGlobe size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Language")}</h3>
        <div className="settings-language-card">
          <p className="settings-theme-info">{t("Choose app language. English is default.")}</p>
          <div className="settings-language-options">
            <button
              type="button"
              className={`settings-language-option ${locale === "en" ? "settings-language-option-active" : ""}`}
              onClick={() => setLocale("en")}
              aria-pressed={locale === "en"}
            >
              English
            </button>
            <button
              type="button"
              className={`settings-language-option ${locale === "no" ? "settings-language-option-active" : ""}`}
              onClick={() => setLocale("no")}
              aria-pressed={locale === "no"}
            >
              Norsk
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title"><IconTarget size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Data Scope")}</h3>
        <IntegrationScopeSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title"><IconBell size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Notifications")}</h3>

        {/* Push notification toggle */}
        <div className="settings-push-card">
          <div className="settings-push-row">
            <div className="settings-push-info">
              <span className="settings-push-label">{t("Push Notifications")}</span>
              <span className="settings-push-desc">
                {pushState === "enabled"
                  ? t("Receiving push notifications")
                  : pushState === "unsupported"
                    ? t("Not supported in this browser")
                    : pushState === "denied"
                      ? t("Permission denied — enable in browser settings")
                      : pushState === "error"
                        ? t("Something went wrong — try again later")
                        : t("Get notified about deadlines, reminders, and updates")}
              </span>
            </div>
            {pushState === "enabled" ? (
              <span className="settings-push-badge">{t("✓ Enabled")}</span>
            ) : (
              <button
                type="button"
                className="settings-push-btn"
                onClick={onEnablePush}
                disabled={pushButtonDisabled}
              >
                {pushState === "checking" ? t("Connecting…") : t("Enable")}
              </button>
            )}
          </div>
          {pushMessage && <p className="settings-push-message">{pushMessage}</p>}
        </div>

        <NotificationSettings />
      </div>

      {/* GDPR / Data section */}
      <div className="settings-section">
        <h3 className="settings-section-title"><IconShield size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Privacy & Data")}</h3>
        <div className="settings-gdpr-card">
          <p className="settings-gdpr-info">
            {t("Your data is processed in accordance with the GDPR (EEA). You can delete your account and all associated data at any time. This action is permanent and cannot be undone.")}
          </p>

          {deleteConfirmStep === 0 && (
            <button
              type="button"
              className="settings-delete-btn"
              onClick={() => setDeleteConfirmStep(1)}
            >
              <IconTrash size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("Delete my account & data")}
            </button>
          )}

          {deleteConfirmStep === 1 && (
            <div className="settings-delete-confirm">
              <p className="settings-delete-warning">
                <IconWarning size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t("This will permanently delete ALL your data: chat history, schedules, deadlines, habits, goals, journal entries, nutrition logs, integrations, and your account. This cannot be undone.")}
              </p>
              <div className="settings-delete-actions">
                <button
                  type="button"
                  className="settings-delete-btn settings-delete-btn-final"
                  onClick={() => setDeleteConfirmStep(2)}
                >
                  {t("I understand, continue")}
                </button>
                <button
                  type="button"
                  className="settings-delete-cancel-btn"
                  onClick={() => setDeleteConfirmStep(0)}
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          )}

          {deleteConfirmStep === 2 && (
            <div className="settings-delete-confirm">
              <p className="settings-delete-warning settings-delete-final-warning">
                <IconCircleFilled size={14} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--color-error, #f44)' }} /> {t("Final confirmation: Are you absolutely sure? All your data will be gone forever.")}
              </p>
              <div className="settings-delete-actions">
                <button
                  type="button"
                  className="settings-delete-btn settings-delete-btn-final"
                  onClick={() => void handleDeleteAccount()}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? t("Deleting…") : t("Yes, permanently delete everything")}
                </button>
                <button
                  type="button"
                  className="settings-delete-cancel-btn"
                  onClick={() => setDeleteConfirmStep(0)}
                  disabled={deleteLoading}
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          )}

          {deleteError && <p className="settings-delete-error">{deleteError}</p>}
        </div>
      </div>

    </div>
  );
}
