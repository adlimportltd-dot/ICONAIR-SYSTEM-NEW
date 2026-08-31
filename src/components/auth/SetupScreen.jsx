import { Brand } from '../Sidebar';

/**
 * מה שרואים כשמשתני הסביבה חסרים.
 * עדיף מסך שמסביר מה חסר ואיפה למצוא אותו, מאשר מסך לבן עם שגיאה בקונסול.
 */
export default function SetupScreen() {
  return (
    <>
      <div className="ambient-field" aria-hidden />

      <div className="relative z-[1] flex min-h-screen items-center justify-center p-5">
        <div className="glass-card w-full max-w-[560px] p-6">
          <div className="mb-5 flex justify-center">
            <Brand compact />
          </div>

          <h1 className="text-center font-display text-[22px] font-bold">חיבור ל-Supabase לא הוגדר</h1>
          <p className="mx-auto mt-2 max-w-prose text-center text-[13px] leading-relaxed text-text-dim">
            צור קובץ <code className="font-mono text-gold-300">.env.local</code> בתיקיית הפרויקט
            עם שני המפתחות האלה, ואז הפעל מחדש את <code className="font-mono text-gold-300">npm run dev</code>.
          </p>

          <pre dir="ltr" className="mt-5 overflow-x-auto rounded-row border border-white/[0.09]
                                    bg-black/40 p-4 text-start font-mono text-[12.5px] leading-relaxed text-text-dim">
{`VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
          </pre>

          <ol className="mt-5 flex list-inside list-decimal flex-col gap-2 text-[12.5px] leading-relaxed text-text-faint">
            <li>בפרויקט שלך ב-Supabase: Project Settings → API</li>
            <li>העתק את <span className="text-text-dim">Project URL</span> ואת המפתח <span className="text-text-dim">anon public</span></li>
            <li>הרץ את שלושת קבצי ה-SQL מתיקיית <span className="font-mono text-gold-300">supabase/</span> לפי הסדר</li>
          </ol>

          <p className="mt-5 text-center text-[11.5px] text-text-faint">
            ה-anon key נועד לרוץ בדפדפן והוא מוגן ב-RLS. את מפתח ה-service_role
            אין לשים בקוד הפרונטאנד לעולם.
          </p>
        </div>
      </div>
    </>
  );
}
