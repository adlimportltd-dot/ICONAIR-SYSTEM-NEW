/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // נקודות השבירה מכוונות לתוכן של ICON AIR ולא לברירת המחדל של Tailwind:
    // xs — שתי עמודות מדדים · sm — שורת קריאה מלאה · md — שדה חיפוש
    // wide — שבב הצי החי · lg — מעבר מניווט תחתון לסרגל צד · xl — ארבע עמודות מדדים
    screens: {
      xs: '560px',
      sm: '680px',
      md: '760px',
      wide: '960px',
      lg: '1080px',
      xl: '1320px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // --- שכבת "זכוכית": צבע גבול/מילוי עדין על גבי המשטח הבהיר ---
        // white במקום Tailwind המקורי — כל white/[x.xx] בקוד הופך אוטומטית
        // למסגרת/הצללה חומה-כהה דקה במקום קו לבן על רקע כהה. black/[x.xx]
        // הופך למילוי קרם רך (שקע עדין), במקום כמעט-שחור על רקע כהה.
        white: '#251E10',
        black: '#F3EDDE',
        ink: {
          950: '#FBF9F4',
          900: '#FFFFFF',
          800: '#F4EFE1',
          700: '#E9E0C9',
        },
        gold: {
          300: '#A9762C',
          500: '#D8B36A',
        },
        teal: {
          500: '#1E948A',
          300: '#4CC9C0',
        },
        slate: {
          500: '#54688A',
          300: '#7E97BE',
        },
        ok: '#1E9E71',
        warn: '#C97A1B',
        crit: '#D93B44',
        'crit-soft': '#B8323C',
        text: {
          DEFAULT: '#221B0C',
          dim: '#6B6255',
          faint: '#9C917E',
        },
      },
      fontFamily: {
        // Assistant נושא את כל טקסט הממשק בעברית
        ui: ['Assistant', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Frank Ruhl Libre — כותרות ומספרי-על. סריף עברי, נותן את התחושה היוקרתית
        display: ['Frank Ruhl Libre', 'Assistant', 'Georgia', 'serif'],
        // IBM Plex Mono — רק ללטינית/קודים (ICN-700-0142). לא לעברית: אין לו גליפים עבריים
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '24px',
        panel: '20px',
        row: '16px',
        pill: '13px',
      },
      boxShadow: {
        lift: '0 24px 48px -30px rgba(0,0,0,.95)',
        'glass-hi': 'inset 0 1px 0 rgba(255,255,255,.07)',
        'gold-glow': '0 0 14px 1px rgba(216,179,106,.7)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        pulseDot: {
          '0%,100%': { opacity: '1', boxShadow: '0 0 0 0 rgba(78,217,164,.55)' },
          '50%': { opacity: '.65', boxShadow: '0 0 0 6px rgba(78,217,164,0)' },
        },
      },
      animation: {
        rise: 'rise .6s cubic-bezier(.2,.7,.3,1) backwards',
        'pulse-dot': 'pulseDot 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
