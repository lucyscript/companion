import { ThemePreference } from "../types";

export interface ThemeOption {
  id: ThemePreference;
  label: string;
  description: string;
  preview: [string, string, string];
}

export const DEFAULT_THEME: ThemePreference = "dark";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Clean neutral dark with cool blue accents.",
    preview: ["#1c1c1e", "#111113", "#60a5fa"]
  },
  {
    id: "ocean-gold",
    label: "Ocean Gold",
    description: "Deep blue with warm gold accents.",
    preview: ["#1f5a76", "#0f1f2f", "#f6c37f"]
  },
  {
    id: "emerald-dusk",
    label: "Emerald Dusk",
    description: "Teal dusk tones with mint highlights.",
    preview: ["#165954", "#0e2227", "#73e4bc"]
  },
  {
    id: "sunset-indigo",
    label: "Sunset Indigo",
    description: "Indigo night with coral sunset accents.",
    preview: ["#4a2f67", "#181025", "#ffb38a"]
  }
];

const THEME_COLORS: Record<ThemePreference, string> = {
  "dark": "#0f0f11",
  "ocean-gold": "#0f1f2f",
  "emerald-dusk": "#0e2227",
  "sunset-indigo": "#181025"
};

const VALID_THEME_IDS = new Set<ThemePreference>(THEME_OPTIONS.map((theme) => theme.id));

export function normalizeThemePreference(value: unknown): ThemePreference {
  if (typeof value === "string" && VALID_THEME_IDS.has(value as ThemePreference)) {
    return value as ThemePreference;
  }
  return DEFAULT_THEME;
}

export function applyTheme(preference: ThemePreference): ThemePreference {
  const resolved = normalizeThemePreference(preference);
  const root = document.documentElement;
  root.dataset.theme = "dark";
  root.dataset.colorTheme = resolved;

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", THEME_COLORS[resolved]);
  }

  return resolved;
}
