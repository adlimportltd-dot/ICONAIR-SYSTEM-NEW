/**
 * סליידר בחירת כמות (מ"ל) — קפיצות של 10 מ"ל, מקסימום = קיבולת המכל
 * של הדגם הספציפי שמול הטכנאי (capacity_ml, ר' device_models). מיועד
 * למגע באצבע בשטח, לא לעכבר — אצבע גדולה (ר' .gold-slider ב-index.css).
 *
 * dir="ltr" במפורש על ה-input עצמו (לא על העמוד): טווח/כמות הוא תוכן
 * מספרי, כמו טלפון/קוד — לא כל דפדפן ממפה נכון min/max כש-dir="rtl"
 * יורש מהעמוד, אז קיבוע ל-LTR נותן התנהגות עקבית בכל דפדפן/פלטפורמה
 * (ר' הכלל המקביל ב-CLAUDE.md על dir="ltr" לתוכן מספרי מפורש).
 */
export default function MlSlider({ valueMl, maxMl, step = 10, onChange, disabled = false }) {
  const safeMax = Math.max(step, Math.round(maxMl / step) * step || maxMl);
  const clamped = Math.min(Math.max(0, valueMl), safeMax);
  const pct = safeMax > 0 ? Math.round((clamped / safeMax) * 100) : 0;

  return (
    <div>
      <input
        type="range"
        dir="ltr"
        className="gold-slider"
        min={0}
        max={safeMax}
        step={step}
        value={clamped}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, #F59E0B ${pct}%, #E2E8F0 ${pct}%)` }}
        aria-label="כמות ריח שנוספה (מ״ל)"
      />
      <div className="mt-2.5 flex items-center justify-between">
        <span className="tabular font-mono text-[17px] font-bold text-gold-600">{clamped} מ״ל</span>
        <span className="tabular text-[13.5px] text-text-faint">{pct}% מהמכל · מתוך {safeMax} מ״ל</span>
      </div>
    </div>
  );
}
