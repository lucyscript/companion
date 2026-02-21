import { NotificationSettings } from "./NotificationSettings";
import { CalendarImportView } from "./CalendarImportView";
import { IntegrationStatusView } from "./IntegrationStatusView";
import { IntegrationScopeSettings } from "./IntegrationScopeSettings";
import { ConnectorsView } from "./ConnectorsView";
import type { UserPlanInfo } from "../types";

interface SettingsViewProps {
  onCalendarImported: () => void;
  planInfo: UserPlanInfo | null;
  onUpgrade: () => void;
}

export function SettingsView({
  onCalendarImported,
  planInfo,
  onUpgrade
}: SettingsViewProps): JSX.Element {
  return (
    <div className="settings-container">
      <div className="settings-header">
        <span className="settings-header-icon">⚙️</span>
        <h2>Settings</h2>
      </div>

      {/* Plan & Usage section */}
      {planInfo && (
        <div className="settings-section">
          <h3 className="settings-section-title">💎 Your Plan</h3>
          <div className="plan-info-card">
            <div className="plan-info-row">
              <span className={`plan-badge plan-badge-${planInfo.plan}`}>{planInfo.badge}</span>
              <span className="plan-info-name">{planInfo.planName}</span>
              {planInfo.isTrial && planInfo.trialEndsAt && (
                <span className="plan-trial-badge">
                  Trial · ends {new Date(planInfo.trialEndsAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="plan-usage-row">
              <span className="plan-usage-label">AI messages today</span>
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
                ✨ Upgrade plan
              </button>
            )}
          </div>
        </div>
      )}

      <div className="settings-section">
        <h3 className="settings-section-title">🔗 Connected Apps</h3>
        <ConnectorsView />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🔌 Integrations</h3>
        <IntegrationStatusView />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🎯 Data Scope</h3>
        <IntegrationScopeSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🔔 Notifications</h3>
        <NotificationSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">📅 Calendar Import</h3>
        <CalendarImportView onImported={onCalendarImported} />
      </div>
    </div>
  );
}
