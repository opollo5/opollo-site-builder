import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontSize: {
        // 16px is the absolute minimum for all operator-facing text
        'xs':   ['1rem', { lineHeight: '1.5' }],   // 16px — minimum
        'sm':   ['1rem', { lineHeight: '1.5' }],   // 16px — minimum
        'base': ['1rem', { lineHeight: '1.5' }],   // 16px — standard body
        'lg':   ['1.125rem',  { lineHeight: '1.75rem' }],
        'xl':   ['1.25rem',   { lineHeight: '1.75rem' }],
        '2xl':  ['1.5rem',    { lineHeight: '2rem' }],
        '3xl':  ['1.875rem',  { lineHeight: '2.25rem' }],
        '4xl':  ['2.25rem',   { lineHeight: '2.5rem' }],
        '5xl':  ['3rem',      { lineHeight: '1' }],
        '6xl':  ['3.75rem',   { lineHeight: '1' }],
        '7xl':  ['4.5rem',    { lineHeight: '1' }],
        '8xl':  ['6rem',      { lineHeight: '1' }],
        '9xl':  ['8rem',      { lineHeight: '1' }],
      },
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
        /* Composer v3 fonts */
        'c3-display': ['var(--c3-font-display)'],
        'c3-body':    ['var(--c3-font-body)'],
        'c3-mono':    ['var(--c3-font-mono)'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        canvas: "hsl(var(--canvas))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Opollo raw tokens — semantic aliases to shadcn tokens */
        pk:  "hsl(var(--primary))",
        pk2: "#00A86B",
        gr:  "hsl(var(--success))",
        gr2: "#00875a",
        bl:  "hsl(var(--info))",
        am:  "hsl(var(--warning))",
        rd:  "hsl(var(--destructive))",
        d1: "var(--d1)",
        d2: "var(--d2)",
        d3: "var(--d3)",
        d4: "var(--d4)",
        "bg-base": "var(--bg)",
        /* Opollo muted/border tokens — use as text-m2, bg-b1, border-b3, etc. */
        m1: "var(--m1)",
        m2: "var(--m2)",
        m3: "var(--m3)",
        m4: "var(--m4)",
        b1: "var(--b1)",
        b2: "var(--b2)",
        b3: "var(--b3)",
        "icon-dim": "var(--icon-dim)",
        "nav-active": "var(--nav-active)",
        "nav-hover": "var(--nav-hover)",
        topbar: "var(--topbar-bg)",
        /* Google SERP preview mimicry — used only in the SEO panel snippet */
        serp: {
          title: "#1a0dab",
          url: "#006621",
          desc: "#545454",
        },
        /* UI consistency semantic text tokens (2026-05-08).
         * Use as: text-tx-primary, text-tx-secondary, text-tx-muted, text-tx-inverse.
         * bg-tx-* and border-tx-* also available via Tailwind's utilities. */
        "tx-primary":   "var(--tx-primary)",    /* #111827 gray-900 */
        "tx-secondary": "var(--tx-secondary)",  /* #374151 gray-700 */
        "tx-muted":     "var(--tx-muted)",      /* #6B7280 gray-500 */
        "tx-inverse":   "var(--tx-inverse)",    /* #FFFFFF */
        /* Semantic callout color trios (D9) */
        "success-bg":     "var(--color-success-bg)",
        "success-fg":     "var(--color-success-fg)",
        "success-border": "var(--color-success-border)",
        "warning-bg":     "var(--color-warning-bg)",
        "warning-fg":     "var(--color-warning-fg)",
        "warning-border": "var(--color-warning-border)",
        "danger-bg":      "var(--color-danger-bg)",
        "danger-fg":      "var(--color-danger-fg)",
        "danger-border":  "var(--color-danger-border)",
        "info-bg":        "var(--color-info-bg)",
        "info-fg":        "var(--color-info-fg)",
        "info-border":    "var(--color-info-border)",
      },
      boxShadow: {
        'pk-glow': '0 4px 24px var(--pk-glow)',
        /* Composer v3 shadows */
        'c3-sm':      'var(--c3-shadow-sm)',
        'c3-md':      'var(--c3-shadow-md)',
        'c3-lg':      'var(--c3-shadow-lg)',
        'c3-overlay': 'var(--c3-shadow-overlay)',
        'c3-focus':   'var(--shadow-focus)',
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        /* Composer v3 radii */
        'c3-sm':   'var(--c3-radius-sm)',
        'c3-md':   'var(--c3-radius-md)',
        'c3-lg':   'var(--c3-radius-lg)',
        'c3-xl':   'var(--c3-radius-xl)',
        'c3-2xl':  'var(--c3-radius-2xl)',
        'c3-full': 'var(--c3-radius-full)',
      },
      transitionTimingFunction: {
        'c3-out':    'cubic-bezier(0.16, 1, 0.3, 1)',
        'c3-snap':   'cubic-bezier(0.22, 1, 0.36, 1)',
        'c3-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        'c3-instant': '60ms',
        'c3-fast':    '120ms',
        'c3-base':    '200ms',
        'c3-slow':    '320ms',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
