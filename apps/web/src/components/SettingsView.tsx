import { NotificationSettings } from "./NotificationSettings";
import { CalendarImportView } from "./CalendarImportView";
import { NotificationHistoryView } from "./NotificationHistoryView";
import { IntegrationStatusView } from "./IntegrationStatusView";
import { IntegrationScopeSettings } from "./IntegrationScopeSettings";

interface SettingsViewProps {
  onCalendarImported: () => void;
}

export function SettingsView({
  onCalendarImported
}: SettingsViewProps): JSX.Element {
  return (
    <div className="settings-container">
      <h2>Settings</h2>
      <IntegrationStatusView />
      <IntegrationScopeSettings />
      <NotificationSettings />
      <CalendarImportView onImported={onCalendarImported} />
      <NotificationHistoryView />
    </div>
  );
}
