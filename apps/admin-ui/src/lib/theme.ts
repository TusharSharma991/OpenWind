export type ThemeMode = "dark" | "light";

export interface AccentColor {
  id: string;
  label: string;
  h: number;
  s: number;
  l: number;
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "purple", label: "Purple", h: 250, s: 84, l: 60 },
  { id: "blue", label: "Blue", h: 213, s: 84, l: 56 },
  { id: "indigo", label: "Indigo", h: 240, s: 80, l: 58 },
  { id: "teal", label: "Teal", h: 175, s: 70, l: 44 },
  { id: "green", label: "Green", h: 152, s: 70, l: 42 },
  { id: "orange", label: "Orange", h: 30, s: 90, l: 52 },
  { id: "rose", label: "Rose", h: 350, s: 80, l: 58 },
  { id: "pink", label: "Pink", h: 312, s: 78, l: 58 },
];

const STORAGE_THEME = "ow_theme";
const STORAGE_ACCENT = "ow_accent";

export function getSavedTheme(): ThemeMode {
  return (localStorage.getItem(STORAGE_THEME) as ThemeMode | null) ?? "dark";
}

export function getSavedAccent(): AccentColor {
  const id = localStorage.getItem(STORAGE_ACCENT);
  const found = ACCENT_COLORS.find((c) => c.id === id);
  // ACCENT_COLORS is always non-empty — the fallback cast is safe
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return found ?? ACCENT_COLORS[0]!;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem(STORAGE_THEME, mode);
}

export function applyAccent(color: AccentColor): void {
  const root = document.documentElement;
  const { h, s, l } = color;
  root.style.setProperty("--accent-h", String(h));
  root.style.setProperty("--accent-s", `${s}%`);
  root.style.setProperty("--accent-l", `${l}%`);
  root.style.setProperty("--accent-primary", `hsl(${h}, ${s}%, ${l}%)`);
  root.style.setProperty(
    "--accent-secondary",
    `hsl(${h + 22}, ${s}%, ${l - 6}%)`,
  );
  root.style.setProperty(
    "--accent-hover",
    `hsl(${h}, ${Math.min(s + 10, 100)}%, ${Math.min(l + 8, 90)}%)`,
  );
  root.style.setProperty("--border-focus", `hsla(${h}, ${s}%, ${l}%, 0.4)`);
  localStorage.setItem(STORAGE_ACCENT, color.id);
}

export function initTheme(): void {
  applyTheme(getSavedTheme());
  applyAccent(getSavedAccent());
}
