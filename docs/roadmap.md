# Companion — Product Roadmap

> Where the app is heading, the steps to get there, and the strategy to become the go-to student companion in Norway and beyond.

---

## Vision

**Companion becomes the default AI layer for student life in Norway** — the app students install during orientation and keep on their home screen all semester. It starts with UiS (University of Stavanger) and expands to every Norwegian university, then to the Nordics, and eventually to English-speaking markets globally.

---

## Current State (v1.0 — Internal Beta)

### What Works Today

| Area | Status | Notes |
|------|--------|-------|
| **Chat with Gemini** | ✅ Solid | Norwegian + English, 46 tools, citations, voice input, image attach |
| **Schedule** | ✅ Solid | TP + TimeEdit iCal sync, day navigation, "Now" indicator, free-period gaps |
| **Deadlines** | ✅ Solid | Canvas/Blackboard sync, countdown badges, 14+ pending deadlines visible |
| **Habits & Goals** | ✅ Solid | Check-in, streaks, progress bars, animated trophy/flame icons |
| **Daily Reflection (Growth)** | ✅ Impressive | AI-generated artwork, personalized insight, 4 challenge card types (Reflect/Predict/Commit/Connect the dots) |
| **Nutrition/Food** | ⚠️ Functional | Macros, meals, tracking charts, Withings integration — but empty-state UX is weak |
| **Onboarding** | ⚠️ Decent | 4-screen intro with phone mockups — could be more interactive |
| **Settings** | ✅ Rich | 4 themes, language toggle, Canvas course scope, notification controls, GDPR delete |
| **Auth** | ✅ Works | Google + GitHub OAuth, session-based |
| **Push Notifications** | ⚠️ Built | Smart nudges, deadline alerts, quiet hours — needs iOS PWA testing |
| **Payments** | ⚠️ Backend ready | Stripe + Vipps MobilePay configured, but no visible upgrade flow in UI |
| **PWA Install** | ⚠️ Has prompt | Install banner exists, but add-to-homescreen flow could be more prominent |

### Honest Assessment (Consumer/Tester Perspective)

**First Impressions**: The dark theme is polished and professional. The onboarding phone mockups set good expectations. Login via Google is frictionless — one tap.

**Chat**: The conversational AI is the star. It speaks fluent Norwegian, knows the user's schedule, tracks habits, checks weather, and sets reminders. Emoji usage feels natural, not forced. Citations with expandable sources build trust. The chat is genuinely useful — this is a real differentiator.

**Schedule**: Clean and informative. The time-block layout with free periods is visually clear. "Happening Now" badges and the green "Now" indicator work well. Deadlines below the schedule create a natural planning flow.

**Growth**: The AI-generated daily reflection art is a genuine delight — it makes the app feel premium and personal. The challenge cards (Reflect, Predict, Commit, Connect the dots) are thoughtful. Habit progress bars and streak counters provide satisfying visual feedback.

**Pain Points Observed**:
1. **Food tab feels abandoned** — "No meals logged yet" with no guidance on how to start. Needs an empty-state illustration + a "Log your first meal" prompt or a quick-start card.
2. **Skeleton loading in Growth** — The large gray placeholder before the AI artwork loads feels like a broken image. (Fix already applied in this session.)
3. **Theme switching occasionally locks up** — Buttons appeared disabled during testing; may be a race condition.
4. **No upgrade flow visible** — PRO plan is shown in Settings but there's no way to view pricing or upgrade. The Free→Plus→Pro funnel needs a UI surface.
5. **Chat overlay vs. Chat tab** — The floating chat button (FAB) on other tabs opens an overlay, but the relationship between the overlay and the Chat tab could confuse new users.
6. **No interactive tutorial** — Onboarding is informational but doesn't teach the user anything (e.g., "try asking me…" prompts).

---

## Phase 1 — Launch-Ready Polish (Weeks 1–4)

*Goal: Get to a state where you can hand the app to 100 UiS students and it just works.*

### 1.1 Empty States & First-Run Guidance
- [ ] Design empty-state illustrations for Food, Growth (when no habits exist), and Schedule (when no connectors linked)
- [ ] Add contextual "Get Started" cards: "Say 'log my lunch' in Chat to start tracking" in Food tab
- [ ] On first chat open, pre-populate 3 suggested messages ("What's my schedule today?", "Set a gym reminder", "How am I doing this week?")

### 1.2 Upgrade Flow & Monetization
- [ ] Build an upgrade modal accessible from Settings → Plan and from feature-gate overlays
- [ ] Show plan comparison table (Free vs Plus vs Pro) with pricing in NOK
- [ ] Integrate Stripe Checkout for international + Vipps for Norwegian users
- [ ] Add 14-day Pro trial for new signups
- [ ] Track conversion events (view pricing → start trial → subscribe)

### 1.3 Onboarding V2
- [ ] Replace static phone mockups with an interactive mini-tutorial
- [ ] Screen 1: "Type 'hello' to meet your companion" (live chat demo)
- [ ] Screen 2: "Connect your schedule" (TP/TimeEdit URL input)
- [ ] Screen 3: "Set your first goal" (inline goal creation)
- [ ] Auto-detect university from email domain (e.g., `@stud.uis.no` → UiS preset with TP iCal URL)

### 1.4 Bug Fixes & Edge Cases
- [ ] Fix theme switching disabled state race condition
- [ ] Audit and fix skeleton loading across all tabs (Growth skeleton fix done ✅)
- [ ] Test push notifications on iOS Safari PWA (known platform restrictions)
- [ ] Handle offline → online transition gracefully (enqueue actions, show sync status)
- [ ] Harden the chat FAB overlay → Chat tab context hand-off

### 1.5 Performance
- [ ] Lazy-load the AnalyticsDashboard (code-split Growth tab)
- [ ] Cache AI-generated artwork in IndexedDB to avoid re-fetching
- [ ] Optimize initial bundle size (target < 200 KB gzipped)
- [ ] Add service worker caching strategy for API responses

---

## Phase 2 — Campus Launch at UiS (Weeks 5–10)

*Goal: 500+ active students at University of Stavanger.*

### 2.1 University-Specific Features
- [ ] **Auto-setup for UiS**: Detect `stud.uis.no` email, pre-configure TP iCal + Canvas base URL
- [ ] **Course group chat context**: Pull Canvas announcements and discussion highlights into Gemini's context
- [ ] **Exam countdown mode**: Prominent exam countdown (from Canvas), auto-generated study plan
- [ ] **Obligatory activity tracker**: Norwegian universities have compulsory attendance ("obligatorisk oppmøte") — track and warn

### 2.2 Social Proof & Virality
- [ ] **Share your streak**: Generate a shareable Instagram story image when a habit streak hits 7/14/30 days
- [ ] **Referral system**: "Invite a classmate, get 1 week of Pro free" 
- [ ] **University leaderboard** (optional/anonymized): "UiS students logged 2,400 study hours this week"
- [ ] **"How I studied for exams" export**: AI-generated summary of the user's study patterns — shareable

### 2.3 Student-Friendly Pricing
- [ ] Implement student verification (FEIDE login or `.stud.*` email validation)
- [ ] Student discount: Plus at 29 NOK/mo, Pro at 59 NOK/mo (permanent, not trial)
- [ ] Semester payment option (pay 4 months, get 5)
- [ ] Partner with Studentsamskipnaden (SiS/SiO) for bundled promotion

### 2.4 Norwegian Localization Deep Dive
- [ ] Full i18n coverage (not just "AI speaks Norwegian" — all UI strings in both nb-NO and en)
- [ ] Norwegian academic calendar awareness (semester start/end, exam periods, holiday calendar)
- [ ] Integration with Sikt/FEIDE for institutional SSO

---

## Phase 3 — Multi-University Expansion (Weeks 11–20)

*Goal: 5,000+ students across 5+ Norwegian universities.*

### 3.1 University Onboarding Kit
- [ ] Admin dashboard for university ambassadors (usage stats, popular courses, feedback)
- [ ] Pre-configured profiles per university (NTNU, UiO, UiB, UiT, UiA, HVL, OsloMet)
- [ ] Automatic LMS detection (Canvas vs Blackboard vs other) from institution
- [ ] Bulk invite via university email lists

### 3.2 Feature Depth
- [ ] **Study groups**: Shared deadlines and goals within a course group
- [ ] **Focus mode**: Pomodoro timer (already built!) integrated with habit tracking — "4 focus sessions today ✅"
- [ ] **Smart scheduling**: AI suggests optimal study blocks based on energy patterns and deadline proximity
- [ ] **Spaced repetition hints**: "You reviewed Paxos 3 days ago — time to review again before the lab"
- [ ] **Grade predictor**: Based on study hours logged vs. historical performance patterns

### 3.3 Data & Insights
- [ ] Weekly email digest: "Your week in review" with AI-generated summary
- [ ] Semester-end analytics: "This semester you studied 340 hours, completed 95% of deadlines, hit the gym 47 times"
- [ ] Exportable study log (PDF/CSV) for scholarship applications

### 3.4 Platform Expansion
- [ ] **Native wrapper (Capacitor/Expo)** for App Store + Google Play
  - Push notifications without PWA limitations
  - Native biometric auth
  - App Store presence = discoverability + trust
- [ ] **Widget support**: Android lock screen widget showing next event + deadline countdown
- [ ] **Apple Watch / Wear OS**: Quick habit check-in from wrist

---

## Phase 4 — Nordic Expansion (Weeks 21–36)

*Goal: 20,000+ students across Norway, Sweden, Denmark, Finland.*

### 4.1 Internationalization
- [ ] Add Swedish (sv), Danish (da), and Finnish (fi) language support
- [ ] Integration with country-specific LMS platforms (Ladok in Sweden, etc.)
- [ ] Country-specific academic calendars and holiday dates
- [ ] Local payment options (Swish for Sweden, MobilePay for Denmark)

### 4.2 Partnerships
- [ ] Student union partnerships (NSO in Norway, SFS in Sweden)
- [ ] University IT department integrations (official LMS connector status)
- [ ] Academic publisher partnerships (textbook recommendations linked to courses)

### 4.3 Community Features
- [ ] Cross-university study groups (students taking similar courses at different institutions)
- [ ] Mentor matching: Senior students help juniors, tracked through the app
- [ ] Campus event integration (from student union calendars)

---

## Phase 5 — Global & Beyond (6+ Months)

### 5.1 English Market Launch
- [ ] Target UK and US universities
- [ ] Integration with Blackboard, Moodle, Brightspace (broader LMS coverage)
- [ ] Time zone handling and regional academic calendars

### 5.2 AI Evolution
- [ ] **Multi-modal input**: Scan your lecture notes (camera → OCR → summary in chat)
- [ ] **Voice-first mode**: Hands-free companion while walking/commuting
- [ ] **Proactive coaching**: "I noticed you haven't studied for DAT520 this week and the lab is in 3 days — want me to block 2 hours tomorrow?"
- [ ] **Learning style adaptation**: Adjust AI personality and suggestions based on user behavior patterns

### 5.3 Platform Economy
- [ ] **MCP marketplace**: University IT departments and third-party developers can publish MCP servers that extend Companion's capabilities
- [ ] **API for institutions**: University admins get aggregate (anonymized) engagement data
- [ ] **Premium add-ons**: AI tutor mode for specific courses (per-course subscription)

---

## Success Metrics

### North Star Metrics
| Metric | Target (6 months) | Target (12 months) |
|--------|-------------------|---------------------|
| **DAU** (Daily Active Users) | 2,000 | 15,000 |
| **D7 Retention** | 60% | 70% |
| **D30 Retention** | 35% | 45% |
| **Messages/user/day** | 8+ | 12+ |
| **Paid conversion** | 8% | 12% |
| **NPS** | 50+ | 65+ |

### Leading Indicators
- % of users who connect at least one integration (Canvas/TP) within 24h of signup
- % of users who set at least one habit within 48h
- Average time-to-first-value (first useful AI response)
- Weekly streak completion rate
- Referral rate (invited friends / active users)

---

## Growth Strategy — Becoming Popular Among Norwegian Students

### Why Students Will Use It
1. **It saves time**: "What's my schedule today?" → instant answer vs. opening 3 different apps
2. **It reduces anxiety**: Deadline countdowns, study plan generation, and proactive reminders mean fewer surprises
3. **It builds discipline**: Habit streaks and goal tracking with an AI accountability partner
4. **It speaks Norwegian**: Most productivity apps are English-only. Companion is natively bilingual.
5. **It knows your university**: Canvas sync, TP schedule, campus-specific context — not a generic tool

### Acquisition Channels (Ranked by Expected Impact)

| Channel | Strategy | Est. Cost |
|---------|----------|-----------|
| **1. Word of mouth** | Make the product so good people screenshot it and share. The AI artwork in Growth tab is already "share-worthy." | Free |
| **2. Campus ambassadors** | Recruit 2–3 student ambassadors per university. Give them free Pro + referral bonuses. | ~500 NOK/campus |
| **3. Student Facebook groups** | "Informatikk UiS", "Maskinstudentene NTNU" etc. — post demo videos, not ads. | Free |
| **4. Fadderuke (orientation week)** | Partner with student unions to demo Companion during orientation. QR code → instant PWA install. | Event cost |
| **5. Reddit/Pair-programming** | Posts in r/norge, r/ntnu, r/UiO showing the AI in action | Free |
| **6. TikTok/Instagram Reels** | Short demos: "POV: Your AI companion texting you before exams" | Time only |
| **7. University newsletters** | Pitch to university IT / student services for inclusion in semester newsletters | Free |

### Retention Hooks
1. **Daily morning briefing**: The AI says good morning with today's schedule → creates a daily open habit
2. **Streak psychology**: "Don't break your 14-day gym streak!" → daily re-engagement
3. **Deadline urgency**: Upcoming deadlines create natural pull back to the app
4. **AI-generated artwork**: The daily reflection visual is unique and changes every day → curiosity + delight
5. **Norwegian language**: Once a student builds habits in Norwegian, switching to an English app feels like friction

---

## Competitive Landscape

| Competitor | Weakness | Companion Advantage |
|-----------|----------|-------------------|
| **Notion** | Generic, no AI schedule management, no LMS sync | Purpose-built for students, Canvas integration |
| **Todoist** | Task-only, no nutrition/habits, no AI | Holistic: schedule + habits + nutrition + AI coaching |
| **ChatGPT** | No persistent context, no integrations, no schedule | Full context of user's academic life |
| **MyStudyLife** | Outdated, no AI, no Norwegian | Modern UI, AI-powered, bilingual |
| **Tiimo (Danish)** | Visual scheduling for ADHD, no AI, limited integrations | AI companion + deeper integrations |
| **Apple Calendar + Reminders** | Fragmented, no AI context, no academic integrations | Single app, academic-aware, proactive |

---

## Technical Priorities

1. **App Store presence** (Capacitor wrapper) — essential for discoverability and trust
2. **FEIDE SSO** — removes friction for Norwegian university students
3. **Offline-first resilience** — students have spotty WiFi in lecture halls
4. **Sub-1s chat response time** — speed = perceived intelligence
5. **E2E encryption for chat** — privacy is a competitive moat, especially under GDPR

---

## Desktop App Roadmap

Companion is a mobile-first PWA, but a desktop app serves students who study at their laptop for hours. The path from PWA → desktop:

### Phase D1 — Enhanced PWA (Now)
- [x] PWA manifest with `display: standalone` — already works as a "desktop app" via Chrome's install
- [ ] Add a desktop install prompt (banner) on non-mobile viewports
- [ ] Optimize layout for wider screens (720px+): two-column chat + schedule side-by-side
- [ ] Keyboard shortcuts (Cmd/Ctrl+K for quick chat, Cmd+1–5 for tab switching)

### Phase D2 — Electron / Tauri Wrapper (Phase 3 timeline)
- [ ] **Tauri** (preferred — lighter than Electron, Rust backend, ~5 MB binary vs ~150 MB)
  - Wrap the existing Vite build as a Tauri app
  - Native system tray icon with deadline countdown
  - Native push notifications (no browser permission barriers)
  - Auto-launch on login (opt-in)
- [ ] **Hotkey overlay**: Global shortcut (e.g., Cmd+Shift+C) opens a focused chat window from anywhere
- [ ] **Focus mode integration**: Detect full-screen apps and suppress notifications during focus

### Phase D3 — Platform-Specific Features
- [ ] macOS: Menu bar companion with next-event preview
- [ ] Windows: Taskbar jump list (Quick chat, Today's schedule, Log a meal)
- [ ] Linux: Tray icon with GNOME/KDE integration
- [ ] Cross-device sync: Start a chat on phone, continue on desktop seamlessly (already handled by server-side state)

### Why Tauri Over Electron
| | Tauri | Electron |
|---|-------|----------|
| **Bundle size** | ~5 MB | ~150 MB |
| **RAM usage** | ~30 MB | ~200 MB |
| **Security** | Rust backend, sandboxed | Node.js, broader attack surface |
| **Auto-update** | Built-in | Requires electron-updater |
| **Platform support** | macOS, Windows, Linux | Same |

The PWA already provides 90% of the desktop experience. The Tauri wrapper adds native OS integration (tray, hotkeys, auto-launch) that students who live on their laptops will appreciate.

---

*Last updated: February 2026*
