// src/lib/ui/portfolioTheme.ts

type ThemeScale = Readonly<{
  white: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  textMuted: string;
  textFaint: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  accent: string;
  accentSoft: string;
  shadowSoft: string;
}>;

type ThemeFonts = Readonly<{
  sans: string;
  mono: string;
}>;

export const PORTFOLIO_THEME: ThemeScale = {
  white: "#ffffff",
  surface: "#f7f7f7",
  surfaceAlt: "#fafafa",
  border: "#e9e9e9",
  borderStrong: "#1f1f1f",
  text: "#0a0a0a",
  textSoft: "#333333",
  textMuted: "#666666",
  textFaint: "#999999",
  success: "#166534",
  successSoft: "#f0fdf4",
  warning: "#b45309",
  warningSoft: "#fffbeb",
  danger: "#b91c1c",
  dangerSoft: "#fef2f2",
  accent: "#0cb8b6",
  accentSoft: "rgba(12, 184, 182, 0.12)",
  shadowSoft: "0 10px 30px rgba(0,0,0,0.04)",
} as const;

export const PORTFOLIO_FONTS: ThemeFonts = {
  sans: `'Familjen Grotesk', 'Helvetica Neue', Arial, sans-serif`,
  mono: `'DM Mono', 'Courier New', monospace`,
} as const;

export const PORTFOLIO_CSS_VARS = {
  "--ui-bg": PORTFOLIO_THEME.white,
  "--ui-panel": PORTFOLIO_THEME.white,
  "--ui-panelAlt": PORTFOLIO_THEME.surfaceAlt,
  "--ui-border": PORTFOLIO_THEME.border,
  "--ui-border-strong": PORTFOLIO_THEME.borderStrong,
  "--ui-text": PORTFOLIO_THEME.text,
  "--ui-text-soft": PORTFOLIO_THEME.textSoft,
  "--ui-muted": PORTFOLIO_THEME.textMuted,
  "--ui-faint": PORTFOLIO_THEME.textFaint,
  "--ui-success": PORTFOLIO_THEME.success,
  "--ui-successSoft": PORTFOLIO_THEME.successSoft,
  "--ui-warning": PORTFOLIO_THEME.warning,
  "--ui-warningSoft": PORTFOLIO_THEME.warningSoft,
  "--ui-danger": PORTFOLIO_THEME.danger,
  "--ui-dangerSoft": PORTFOLIO_THEME.dangerSoft,
  "--ui-accent": PORTFOLIO_THEME.accent,
  "--ui-accentSoft": PORTFOLIO_THEME.accentSoft,
  "--ui-shadow-soft": PORTFOLIO_THEME.shadowSoft,
  "--ui-font-sans": PORTFOLIO_FONTS.sans,
  "--ui-font-mono": PORTFOLIO_FONTS.mono,

  // legacy bridge vars for older portfolio pages
  "--white": PORTFOLIO_THEME.white,
  "--off": PORTFOLIO_THEME.surface,
  "--off-2": PORTFOLIO_THEME.surfaceAlt,
  "--rule": PORTFOLIO_THEME.border,
  "--rule-heavy": PORTFOLIO_THEME.borderStrong,
  "--ink": PORTFOLIO_THEME.text,
  "--ink-2": PORTFOLIO_THEME.textSoft,
  "--ink-3": PORTFOLIO_THEME.textMuted,
  "--ink-4": PORTFOLIO_THEME.textFaint,
  "--amber": PORTFOLIO_THEME.warning,
  "--amber-bg": PORTFOLIO_THEME.warningSoft,
  "--red": PORTFOLIO_THEME.danger,
  "--red-bg": PORTFOLIO_THEME.dangerSoft,
  "--green": PORTFOLIO_THEME.success,
  "--green-bg": PORTFOLIO_THEME.successSoft,
  "--font": PORTFOLIO_FONTS.sans,
  "--mono": PORTFOLIO_FONTS.mono,
  "--shadow-soft": PORTFOLIO_THEME.shadowSoft,
} as const;

export function portfolioGlobalCss(selector = ":root"): string {
  const lines = Object.entries(PORTFOLIO_CSS_VARS).map(
    ([key, value]) => `  ${key}: ${value};`,
  );

  return `${selector} {\n${lines.join("\n")}\n}`;
}

export function portfolioVarsStyle(
  selector = ":root",
): {
  __html: string;
} {
  return {
    __html: portfolioGlobalCss(selector),
  };
}