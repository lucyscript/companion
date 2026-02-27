import { useEffect, useState } from "react";
import {
  dismissInstallPrompt,
  isInstallPromptDismissed,
  shouldShowInstallPrompt,
  isIOSSafari,
  hasDeferredInstallPrompt,
  triggerNativeInstall,
  onInstallPromptAvailable,
} from "../lib/install";
import { useI18n } from "../lib/i18n";

export function InstallPrompt(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const check = (): void => {
      if (isInstallPromptDismissed()) return;
      if (hasDeferredInstallPrompt()) {
        setIsNative(true);
        setVisible(true);
      } else if (shouldShowInstallPrompt()) {
        setIsNative(false);
        setVisible(true);
      }
    };

    check();

    // Also listen for the beforeinstallprompt event (may fire after mount)
    const unsub = onInstallPromptAvailable(() => {
      if (!isInstallPromptDismissed()) {
        setIsNative(true);
        setVisible(true);
      }
    });

    return unsub;
  }, []);

  const handleDismiss = (): void => {
    dismissInstallPrompt();
    setVisible(false);
  };

  const handleNativeInstall = async (): Promise<void> => {
    const outcome = await triggerNativeInstall();
    if (outcome === "accepted") {
      setVisible(false);
    }
  };

  if (!visible) {
    return null;
  }

  // Chrome / Edge / Android — show a simple install banner with a native prompt button
  if (isNative) {
    return (
      <div className="install-prompt install-prompt-native">
        <div className="install-prompt-content">
          <div className="install-prompt-native-row">
            <div className="install-prompt-native-text">
              <h3>{t("Install Companion")}</h3>
              <p>{t("Add to your home screen for the best experience.")}</p>
            </div>
            <div className="install-prompt-native-actions">
              <button type="button" onClick={() => void handleNativeInstall()} className="install-button">
                {t("Install")}
              </button>
              <button type="button" onClick={handleDismiss} className="dismiss-button">
                {t("Not now")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // iOS Safari — show manual instructions
  return (
    <div className="install-prompt">
      <div className="install-prompt-content">
        <h3>{t("Install Companion")}</h3>
        <p>
          {t("Add Companion to your home screen for the best experience with push notifications and offline access.")}
        </p>
        <ol className="install-instructions">
          <li>
            {t("Tap the Share button")}{" "}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ display: "inline", verticalAlign: "middle" }}
            >
              <path d="M8 0.5L8 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M4.5 7L8 3.5L11.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M2 11.5L2 14.5C2 14.7761 2.22386 15 2.5 15L13.5 15C13.7761 15 14 14.7761 14 14.5L14 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>{" "}
            {t("in Safari's toolbar")}
          </li>
          <li>
            {t("Scroll down and tap \"Add to Home Screen\"")}
          </li>
          <li>{t("Tap Add to confirm")}</li>
        </ol>
        <button type="button" onClick={handleDismiss} className="dismiss-button">
          {t("Got it")}
        </button>
      </div>
    </div>
  );
}
