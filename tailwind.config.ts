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
        /* Opollo raw tokens — use as text-pk, bg-gr, border-bl, etc. */
        pk: "var(--pk)",
        pk2: "var(--pk2)",
        gr: "var(--gr)",
        gr2: "var(--gr2)",
        bl: "var(--bl)",
        am: "var(--am)",
        rd: "var(--rd)",
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
