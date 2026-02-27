# Onboarding & Promotional Video Roadmap

## Current State

Onboarding is **fully implemented** as a 4-screen swipeable flow (`OnboardingFlow.tsx`):

| Screen | Content | Visual |
|--------|---------|--------|
| **1 — Welcome** | "Hey! I'm your AI companion." | Custom SVG illustration with sparkle animation |
| **2 — Schedule** | "Your events, deadlines, and goals." | Real screenshot in phone frame mockup |
| **3 — Chat** | "Ask anything, plan your week, or just vent." | Real screenshot in phone frame mockup |
| **4 — Get Started** | "You're all set!" + CTA button | Confetti SVG animation |

**Implementation details**:
- CSS scroll-snap for smooth swiping
- Dot navigation with active indicator
- Skip button on non-final screens
- localStorage gate (`onboarding-done`)
- Mix approach: SVG illustrations for screens 1 & 4, real PNG screenshots in CSS phone frames for screens 2 & 3

**Assets** in `apps/web/public/onboarding/`:
- `onboarding-welcome.svg`, `onboarding-confetti.svg` — custom animated SVGs
- `schedule-preview.png`, `chat-preview.png` — real app screenshots (390×844)

---

## Remaining: Promotional Video

### Purpose
A 30-60 second video for:
- GitHub README hero section
- Social media / portfolio showcase

### Storyboard (30 seconds)

| Time | Scene | Audio/Caption |
|------|-------|------|
| 0-5s | App icon zooms in, sparkle animation | "Meet Companion" |
| 5-12s | Phone mockup showing Chat tab — user types a question, AI responds | "Ask anything about your day" |
| 12-18s | Swipe to Schedule tab — shows today's events with times and locations | "Your full schedule, always up to date" |
| 18-24s | Swipe to Growth tab — analytics and habit tracking | "Track your habits and growth" |
| 24-30s | Quick montage: notifications, meal logging → end on app icon + tagline | "Companion — your AI life assistant" |

### How to Create It

1. Run the app in Chrome DevTools (iPhone 14 Pro frame)
2. Use OBS or macOS Screen Recording to capture interactions
3. Edit in DaVinci Resolve (free) or CapCut (free, mobile)
4. Add captions, transitions, and background music
5. Export as MP4 (1080×1920 for vertical)
