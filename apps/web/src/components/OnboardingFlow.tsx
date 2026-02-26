import { useCallback, useEffect, useRef, useState } from "react";

interface OnboardingFlowProps {
  onComplete: () => void;
}

interface Screen {
  illustration?: string;
  screenshot?: string;
  title: string;
  subtitle: string;
  cta?: boolean;
}

const SCREENS: Screen[] = [
  {
    illustration: "icon.svg",
    title: "Hey! I\u2019m your AI\u00a0companion.",
    subtitle: "I know your schedule, deadlines, and goals \u2014 ask me anything.",
  },
  {
    screenshot: "schedule-preview.png",
    title: "Your events, deadlines,\u00a0and\u00a0goals.",
    subtitle: "Synced from your calendar & integrations, always up to date.",
  },
  {
    screenshot: "chat-preview.png",
    title: "Ask anything, plan\u00a0your\u00a0week, or\u00a0just\u00a0vent.",
    subtitle: "Powered by Gemini with full context about your life.",
  },
  {
    illustration: "onboarding-confetti.svg",
    title: "You\u2019re all set!",
    subtitle: "Let\u2019s make every day count.",
    cta: true,
  },
];

const BASE_PATH = import.meta.env.BASE_URL ?? "/";

export function OnboardingFlow({ onComplete }: OnboardingFlowProps): JSX.Element {
  const [currentScreen, setCurrentScreen] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isLastScreen = currentScreen === SCREENS.length - 1;

  // Track scroll position for dot indicators
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = (): void => {
      const scrollLeft = container.scrollLeft;
      const width = container.clientWidth;
      const index = Math.round(scrollLeft / width);
      setCurrentScreen(Math.min(index, SCREENS.length - 1));
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToScreen = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ left: index * container.clientWidth, behavior: "smooth" });
  }, []);

  const handleNext = useCallback(() => {
    if (isLastScreen) {
      localStorage.setItem("onboarding-done", "1");
      onComplete();
    } else {
      scrollToScreen(currentScreen + 1);
    }
  }, [isLastScreen, currentScreen, onComplete, scrollToScreen]);

  const handleSkip = useCallback(() => {
    localStorage.setItem("onboarding-done", "1");
    onComplete();
  }, [onComplete]);

  return (
    <div className="onboarding-root">
      {/* Skip button (visible on all screens except last) */}
      {!isLastScreen && (
        <button type="button" className="onboarding-skip" onClick={handleSkip}>
          Skip
        </button>
      )}

      {/* Swipeable screens */}
      <div ref={containerRef} className="onboarding-container">
        {SCREENS.map((screen, i) => (
          <div key={i} className="onboarding-screen">
            {screen.illustration ? (
              <div className="onboarding-illustration">
                <img
                  src={`${BASE_PATH}onboarding/${screen.illustration}`}
                  alt=""
                  width="280"
                  height="280"
                  loading={i === 0 ? "eager" : "lazy"}
                />
              </div>
            ) : screen.screenshot ? (
              <div className="onboarding-phone-frame">
                <div className="onboarding-phone-notch" />
                <img
                  src={`${BASE_PATH}onboarding/${screen.screenshot}`}
                  alt=""
                  className="onboarding-phone-screenshot"
                  loading="lazy"
                />
              </div>
            ) : null}
            <h1 className="onboarding-title">{screen.title}</h1>
            <p className="onboarding-subtitle">{screen.subtitle}</p>
          </div>
        ))}
      </div>

      {/* Bottom area: dots + button */}
      <div className="onboarding-footer">
        <div className="onboarding-dots">
          {SCREENS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`onboarding-dot ${i === currentScreen ? "onboarding-dot-active" : ""}`}
              onClick={() => scrollToScreen(i)}
              aria-label={`Go to screen ${i + 1}`}
            />
          ))}
        </div>
        <button
          type="button"
          className={`onboarding-cta ${isLastScreen ? "onboarding-cta-primary" : ""}`}
          onClick={handleNext}
        >
          {isLastScreen ? "Get Started" : "Next"}
        </button>
      </div>
    </div>
  );
}
