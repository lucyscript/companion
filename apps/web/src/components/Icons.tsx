/**
 * Custom SVG icon library — replaces all emoji usage across the app.
 * Style: stroke-based, 24x24 viewBox, matching existing TabBar icons.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const defaults = (size = 16, props: IconProps): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props
});

/* ── Mood / Emotion icons (ChatView mood sets) ── */

/** Flexed bicep — encouraging */
export function IconStrength(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M7 11V4a2 2 0 0 1 4 0v4" />
      <path d="M11 8h1a2 2 0 0 1 2 2v1" />
      <path d="M14 11V9a2 2 0 0 1 4 0v2" />
      <path d="M18 11v1a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8" />
      <path d="M5 8a2 2 0 0 1 2-2" />
    </svg>
  );
}

/** Star — excellence / gold rating */
export function IconStar(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Flame — streak / hot */
export function IconFlame(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

/** Sparkles — celebratory / magical */
export function IconSparkles(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M18 15l.75 2.25L21 18l-2.25.75L18 21l-.75-2.25L15 18l2.25-.75L18 15z" />
    </svg>
  );
}

/** Rocket — progress / launch */
export function IconRocket(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

/** Target / bullseye — goal / deadline */
export function IconTarget(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

/** Brain — smart / thinking */
export function IconBrain(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M9.5 2A5.5 5.5 0 0 0 5 7c0 1.2.4 2.3 1 3.2-.6 1.3-1 2.7-1 4.3A5.5 5.5 0 0 0 10.5 20h.5" />
      <path d="M14.5 2A5.5 5.5 0 0 1 19 7c0 1.2-.4 2.3-1 3.2.6 1.3 1 2.7 1 4.3A5.5 5.5 0 0 1 13.5 20h-.5" />
      <path d="M12 2v18" />
      <path d="M8 8h3" />
      <path d="M13 8h3" />
      <path d="M8 14h3" />
      <path d="M13 14h3" />
    </svg>
  );
}

/** Light bulb — idea / hint */
export function IconLightbulb(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}

/** Lightning bolt — urgent / energy */
export function IconZap(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/** Clock / alarm — time / urgent */
export function IconClock(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

/** Circle dot / record — critical alert */
export function IconAlertCircle(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Running figure — motion / hurry */
export function IconActivity(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

/** Party popper — celebration */
export function IconParty(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M5.8 11.3L2 22l10.7-3.8" />
      <path d="M4 3h.01" />
      <path d="M22 8h.01" />
      <path d="M15 2h.01" />
      <path d="M22 20h.01" />
      <path d="M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0L18.2 8l2.67-.89a2.9 2.9 0 0 0 1.96-3.12L22.38 2z" />
      <path d="M8 14l3-3" />
      <path d="M5 17l2.24-.75a2.9 2.9 0 0 0 1.96-3.12v0L8.8 11l-2.67.89a2.9 2.9 0 0 0-1.96 3.12L4.62 17z" />
    </svg>
  );
}

/** Heart — empathetic */
export function IconHeart(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/** Fist — commitment / solidarity */
export function IconFist(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M7 20h10" />
      <path d="M10 20V6a2 2 0 0 1 4 0v4" />
      <path d="M14 10h1a2 2 0 0 1 2 2v1" />
      <path d="M7 10a2 2 0 0 1 2-2h1" />
      <path d="M17 13v3a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4v-5" />
    </svg>
  );
}

/** Thought bubble — reflect */
export function IconThought(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="10" r="7" />
      <path d="M8.5 18.5a1.5 1.5 0 1 1-2-1" />
      <path d="M6 21a1 1 0 1 1-1-1" />
    </svg>
  );
}

/* ── Data / Citation icons ── */

/** Calendar — schedule */
export function IconCalendar(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/** Notebook / edit — notes / journal */
export function IconNotes(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/** Book stack — assignments / study */
export function IconBooks(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

/** Paperclip — attachment / citation */
export function IconPaperclip(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/** Folder — file / document */
export function IconFolder(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Magnifying glass — search */
export function IconSearch(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Utensils — food / nutrition */
export function IconUtensils(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  );
}

/** Mail / envelope — email */
export function IconMail(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

/** Scale — weight / balance */
export function IconScale(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M12 3v17" />
      <path d="M5 10l7-7 7 7" />
      <path d="M2 20a5 5 0 0 1 5-5" />
      <path d="M22 20a5 5 0 0 0-5-5" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

/** Moon / sleep — rest */
export function IconMoon(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/* ── UI / Status icons ── */

/** Gear / cog — settings */
export function IconGear(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.84 1 1.51 1.08H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
    </svg>
  );
}

/** Diamond — premium / plan */
export function IconDiamond(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z" />
    </svg>
  );
}

/** Palette — appearance */
export function IconPalette(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

/** Link — integrations */
export function IconLink(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Globe — language */
export function IconGlobe(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/** Bell — notification */
export function IconBell(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** Shield — privacy */
export function IconShield(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Trash can — delete */
export function IconTrash(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Triangle warning — caution */
export function IconWarning(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Siren — critical alert */
export function IconSiren(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M7 18v-6a5 5 0 0 1 10 0v6" />
      <path d="M5 21h14" />
      <path d="M12 3v1" />
      <path d="M19 6l-1 1" />
      <path d="M5 6l1 1" />
      <circle cx="12" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}

/** Lock — secure / restricted */
export function IconLock(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Graduation cap — academic */
export function IconGradCap(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M22 10l-10-5L2 10l10 5 10-5z" />
      <path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5" />
      <line x1="22" y1="10" x2="22" y2="16" />
    </svg>
  );
}

/** Checkmark circle — success / completed */
export function IconCheckCircle(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/** X circle — dismissed / error */
export function IconXCircle(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

/** Pointer / cursor click — tapped */
export function IconPointer(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
    </svg>
  );
}

/** Clipboard — log / record */
export function IconClipboard(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

/** Dumbbell — gym / workout */
export function IconDumbbell(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M6.5 6.5h11" />
      <path d="M6.5 17.5h11" />
      <path d="M6.5 6.5v11" />
      <path d="M17.5 6.5v11" />
      <path d="M4 8v8" />
      <path d="M20 8v8" />
      <path d="M2 10v4" />
      <path d="M22 10v4" />
    </svg>
  );
}

/** Pill — medication */
export function IconPill(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M10.5 1.5l-8 8a5.66 5.66 0 0 0 8 8l8-8a5.66 5.66 0 0 0-8-8z" />
      <line x1="6" y1="10" x2="14" y2="18" />
    </svg>
  );
}

/** Sun partial — weather / empty day */
export function IconSunPartial(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

/** Crystal ball — predict */
export function IconCrystalBall(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="10" r="8" />
      <path d="M8 21h8" />
      <path d="M9 18h6" />
      <path d="M9 14c1-2 2-3 3-3s2 1 3 3" />
    </svg>
  );
}

/** Wave hand — greeting */
export function IconWave(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M7.5 12.5l-1-4a1.5 1.5 0 0 1 2.83-1L11 12" />
      <path d="M11 12l-1-4a1.5 1.5 0 0 1 2.83-1L14.5 12" />
      <path d="M14.5 12l-.5-2a1.5 1.5 0 0 1 2.83-1l.5 2" />
      <path d="M17.3 11l.4 1.5a7 7 0 0 1-6.3 8.5H10a7 7 0 0 1-6.3-4" />
      <path d="M5 3a1 1 0 0 1 1 1" />
      <path d="M2 6a2 2 0 0 1 2 2" />
    </svg>
  );
}

/** Red circle / stop — critical */
export function IconCircleFilled(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Circle (unfilled) — status dot */
export function IconCircle(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

/** Exclamation — important */
export function IconExclamation(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Upload / send */
export function IconSend(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

/** Hug / embrace — warm empathy */
export function IconHug(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <circle cx="12" cy="8" r="5" />
      <path d="M3 21v-2a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7v2" />
    </svg>
  );
}

/** Eye — visible / preview */
export function IconEye(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Square checkbox (empty) — incomplete */
export function IconSquare(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  );
}

/** Checkbox (checked) — complete */
export function IconCheckSquare(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)}>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

/** Star (filled) — glowing / shining */
export function IconStarFilled(props: IconProps) {
  const { size, ...rest } = props;
  return (
    <svg {...defaults(size, rest)} fill="currentColor">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
