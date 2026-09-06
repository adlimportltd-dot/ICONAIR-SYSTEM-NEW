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
        // --- פחם עמוק: הבסיס של מותג הפרימיום — שחור/פחם, לא אפור ---
        ink: {
          950: '#0A0A0A',
          900: '#121212',
          800: '#1A1A1A',
          700: '#242424',
        },
        // gold-300 — הזהב הבהיר, לטקסט/אייקונים על גבי הפחם (צריך את
        // הבהירות כדי להיקרא). gold-500 — הזהב המט/עמוק יותר, לכפתורים
        // ולמילויים רוויים.
        gold: {
          300: '#D4AF37',
          500: '#C5A059',
        },
        teal: {
          500: '#4CC9C0',
          300: '#8FE3DC',
        },
        slate: {
          500: '#6E86A8',
          300: '#A3B6CE',
        },
        ok: '#4ED9A4',
        warn: '#F0A43A',
        crit: '#F0555C',
        'crit-soft': '#FF9498',
        text: {
          DEFAULT: '#FFFFFF',
          // #EDEDED — כמעט לבן טהור, לא רק "בהיר יחסית".
          dim: '#EDEDED',
          // 2026-09-06, סבב שני: #A39B8E (~6.8:1) עדיין נתפס כאפור מדי
          // בפועל. #D6D0C4 (~11.4:1 מול #121212) — בהיר במפורש, ברמת
          // zinc-200 של Tailwind — עדיין נבדל מ-dim/DEFAULT הלבנים, אבל
          // אין ספק בקריאה שזה "טקסט בהיר", לא אפור חיוור.
          faint: '#D6D0C4',
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
        // הצללה דו-שכבתית: אחת רחבה ורכה לעומק כללי, אחת צמודה וחדה
        // יותר שנותנת לכרטיס "לקום" מהרקע — ביחד זה מה שנראה תלת-ממדי
        // במקום שטוח, בלי להיות כבד מדי.
        lift: '0 32px 64px -28px rgba(0,0,0,.85), 0 10px 22px -14px rgba(0,0,0,.65)',
        'glass-hi': 'inset 0 1px 0 rgba(255,255,255,.06), inset 0 0 32px rgba(212,175,55,.03)',
        'gold-glow': '0 0 14px 1px rgba(212,175,55,.7)',
        'icon-glow': '0 6px 16px -6px rgba(212,175,55,.35), inset 0 1px 0 rgba(255,255,255,.1)',
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
