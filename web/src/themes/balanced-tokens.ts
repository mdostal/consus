export const balancedTokens = {
  typography: {
    fontFamily: 'var(--font-family-base)',
    fontSizeBase: 'var(--font-size-base)',
    lineHeightBase: 'var(--line-height-base)',
    h1: { size: 'var(--font-size-h1)', weight: 'var(--font-weight-h1)' },
    h2: { size: 'var(--font-size-h2)', weight: 'var(--font-weight-h2)' },
    h3: { size: 'var(--font-size-h3)', weight: 'var(--font-weight-h3)' },
    small: 'var(--font-size-small)',
  },
  spacing: {
    xs: 'var(--spacing-xs)',
    sm: 'var(--spacing-sm)',
    md: 'var(--spacing-md)',
    lg: 'var(--spacing-lg)',
    xl: 'var(--spacing-xl)',
    xxl: 'var(--spacing-xxl)',
  },
  colors: {
    bgPrimary: 'var(--bg-primary)',
    bgSecondary: 'var(--bg-secondary)',
    textPrimary: 'var(--text-primary)',
    textSecondary: 'var(--text-secondary)',
    borderColor: 'var(--border-color)',
    accent: 'var(--accent-color)',
  }
} as const;
