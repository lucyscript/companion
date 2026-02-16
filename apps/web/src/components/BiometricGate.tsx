/**
 * BiometricGate - Lock screen that requires Face ID/Touch ID authentication
 * 
 * This component blocks access to the app until the user successfully
 * authenticates with their enrolled biometric credential.
 */

import { useCallback, useEffect, useState } from "react";
import { authenticateBiometric } from "../lib/biometric";
import type { BiometricCredential } from "../types";

interface BiometricGateProps {
  credential: BiometricCredential;
  onAuthenticated: () => void;
  onSkip: () => void;
}

type AuthState = "ready" | "authenticating" | "error";

export function BiometricGate({ credential, onAuthenticated, onSkip }: BiometricGateProps): JSX.Element {
  const [authState, setAuthState] = useState<AuthState>("ready");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const handleAuthenticate = useCallback(async (): Promise<void> => {
    setAuthState("authenticating");
    setErrorMessage("");

    const result = await authenticateBiometric(credential);

    if (result.success) {
      setAuthState("ready");
      onAuthenticated();
    } else {
      setAuthState("error");
      setErrorMessage(result.error);
    }
  }, [credential, onAuthenticated]);

  // Auto-trigger authentication on mount
  useEffect(() => {
    void handleAuthenticate();
  }, [handleAuthenticate]);

  return (
    <div className="biometric-gate">
      <div className="biometric-gate-content">
        <div className="biometric-icon">
          {/* Face ID icon: stylized face with eyes and mouth representing biometric authentication */}
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2" />
            <circle cx="22" cy="26" r="3" fill="currentColor" />
            <circle cx="42" cy="26" r="3" fill="currentColor" />
            <path d="M32 36 C 26 36, 22 40, 22 44" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M32 36 C 38 36, 42 40, 42 44" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <h2>Authentication Required</h2>
        <p className="biometric-message">
          {authState === "authenticating" && "Authenticating with Face ID/Touch ID..."}
          {authState === "ready" && "Use Face ID or Touch ID to unlock Companion"}
          {authState === "error" && "Authentication failed"}
        </p>

        {errorMessage && (
          <p className="error biometric-error">{errorMessage}</p>
        )}

        <div className="biometric-actions">
          {authState !== "authenticating" && (
            <>
              <button
                type="button"
                onClick={() => void handleAuthenticate()}
                className="biometric-btn-primary"
              >
                {authState === "error" ? "Try Again" : "Authenticate"}
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="biometric-btn-secondary"
              >
                Skip This Time
              </button>
            </>
          )}
        </div>

        <p className="biometric-hint">
          You can disable biometric authentication in Settings.
        </p>
      </div>

      <style>{`
        .biometric-gate {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 1rem;
          background: var(--bg-primary, #fff);
        }

        .biometric-gate-content {
          max-width: 400px;
          width: 100%;
          text-align: center;
        }

        .biometric-icon {
          margin: 0 auto 2rem;
          color: var(--text-primary, #333);
          opacity: 0.8;
        }

        .biometric-gate h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 1rem;
          color: var(--text-primary, #333);
        }

        .biometric-message {
          font-size: 1rem;
          color: var(--text-secondary, #666);
          margin: 0 0 1.5rem;
        }

        .biometric-error {
          margin: 1rem 0;
          padding: 0.75rem;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 0.5rem;
          font-size: 0.875rem;
        }

        .biometric-actions {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin: 2rem 0;
        }

        .biometric-btn-primary,
        .biometric-btn-secondary {
          padding: 0.875rem 1.5rem;
          font-size: 1rem;
          font-weight: 500;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          width: 100%;
        }

        .biometric-btn-primary {
          background: var(--accent, #3b82f6);
          color: white;
        }

        .biometric-btn-primary:hover {
          background: var(--accent-hover, #2563eb);
        }

        .biometric-btn-primary:active {
          transform: scale(0.98);
        }

        .biometric-btn-secondary {
          background: transparent;
          color: var(--text-secondary, #666);
          border: 1px solid var(--border, #e5e7eb);
        }

        .biometric-btn-secondary:hover {
          background: var(--bg-secondary, #f9fafb);
        }

        .biometric-hint {
          font-size: 0.875rem;
          color: var(--text-tertiary, #999);
          margin: 1.5rem 0 0;
        }

        @media (prefers-color-scheme: dark) {
          .biometric-gate {
            background: var(--bg-primary, #1a1a1a);
          }

          .biometric-gate h2,
          .biometric-icon {
            color: var(--text-primary, #f5f5f5);
          }

          .biometric-message {
            color: var(--text-secondary, #aaa);
          }

          .biometric-btn-primary {
            background: var(--accent, #3b82f6);
          }

          .biometric-btn-primary:hover {
            background: var(--accent-hover, #2563eb);
          }

          .biometric-btn-secondary {
            color: var(--text-secondary, #aaa);
            border-color: var(--border, #333);
          }

          .biometric-btn-secondary:hover {
            background: var(--bg-secondary, #2a2a2a);
          }

          .biometric-hint {
            color: var(--text-tertiary, #666);
          }
        }
      `}</style>
    </div>
  );
}
