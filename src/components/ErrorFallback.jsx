import GlassCard from './ui/GlassCard';
import { PrimaryButton, SecondaryButton } from './ui/Field';

/**
 * מסך "קרס" של Sentry.ErrorBoundary — 2026-09-12. עוטף את כל
 * האפליקציה (ר' main.jsx): אם רכיב זורק שגיאה בלתי-צפויה בזמן רינדור,
 * הטכנאי בשטח רואה את זה במקום מסך לבן ריק לגמרי בלי שום הסבר —
 * ועדיין יכול לרענן ולהמשיך לעבוד, בלי לצאת מהאפליקציה.
 */
export default function ErrorFallback({ error, eventId, resetError }) {
  return (
    <div dir="rtl" className="ambient-field flex min-h-screen items-center justify-center p-5">
      <GlassCard className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-crit/25 bg-crit/[0.1] text-[26px]">
          ⚠️
        </div>
        <h1 className="font-display text-[20px] font-extrabold text-text">משהו השתבש</h1>
        <p className="mt-2 text-[14.5px] text-text-dim">
          קרתה שגיאה לא צפויה. הצוות שלנו כבר קיבל דיווח אוטומטי — נסה לרענן את הדף.
        </p>

        {eventId && (
          <p className="tabular mt-2 font-mono text-[12px] text-text-faint">מזהה דיווח: {eventId}</p>
        )}

        <div className="mt-5 flex flex-col gap-2.5 xs:flex-row xs:justify-center">
          <PrimaryButton onClick={() => window.location.reload()}>רענן את הדף</PrimaryButton>
          <SecondaryButton onClick={resetError}>נסה שוב בלי לרענן</SecondaryButton>
        </div>

        {import.meta.env.DEV && error && (
          <pre className="mt-5 max-h-40 overflow-auto rounded-row border border-black/[0.08] bg-black/[0.03] p-3 text-start text-[11px] text-crit-soft">
            {String(error?.stack || error?.message || error)}
          </pre>
        )}
      </GlassCard>
    </div>
  );
}
