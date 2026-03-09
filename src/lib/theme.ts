export const PORTFOLIO_THEME = {
  white: "#ffffff",
  off: "#f7f7f7",
  off2: "#fafafa",
  rule: "#e9e9e9",
  ruleHeavy: "#1f1f1f",
  ink: "#0a0a0a",
  ink2: "#333333",
  ink3: "#666666",
  ink4: "#999999",
  amber: "#b45309",
  amberBg: "#fffbeb",
  red: "#b91c1c",
  redBg: "#fef2f2",
  green: "#166534",
  greenBg: "#f0fdf4",
  shadowSoft: "0 10px 30px rgba(0,0,0,0.04)",
} as const;

export const PORTFOLIO_FONTS = {
  sans: `'Familjen Grotesk', 'Helvetica Neue', sans-serif`,
  mono: `'DM Mono', 'Courier New', monospace`,
} as const;

export function portfolioGlobalCss() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');

    :root {
      --white: ${PORTFOLIO_THEME.white};
      --off: ${PORTFOLIO_THEME.off};
      --off-2: ${PORTFOLIO_THEME.off2};
      --rule: ${PORTFOLIO_THEME.rule};
      --rule-heavy: ${PORTFOLIO_THEME.ruleHeavy};
      --ink: ${PORTFOLIO_THEME.ink};
      --ink-2: ${PORTFOLIO_THEME.ink2};
      --ink-3: ${PORTFOLIO_THEME.ink3};
      --ink-4: ${PORTFOLIO_THEME.ink4};
      --amber: ${PORTFOLIO_THEME.amber};
      --amber-bg: ${PORTFOLIO_THEME.amberBg};
      --red: ${PORTFOLIO_THEME.red};
      --red-bg: ${PORTFOLIO_THEME.redBg};
      --green: ${PORTFOLIO_THEME.green};
      --green-bg: ${PORTFOLIO_THEME.greenBg};
      --font: ${PORTFOLIO_FONTS.sans};
      --mono: ${PORTFOLIO_FONTS.mono};
      --shadow-soft: ${PORTFOLIO_THEME.shadowSoft};
    }
  `;
}
