import { containersLabel, formatDateTime } from '../lib/mappers';

/**
 * דוח "מה להעמיס היום" — 2026-09-11, redesign מלא אחרי משוב "נמרח על
 * פני עשרות דפים לא הגיוני". השורש: הגרסה הקודמת רינדרה את כל התוכן
 * (כולל טבלת "מכשירים חדשים" עם מאות שורות ב"כל הקווים") כתמונה ענקית
 * אחת, ואז חתכה אותה ל-A4 לפי גובה-פיקסלים גולמי — בלי שום קשר לאיפה
 * שורת טבלה מתחילה/נגמרת, ובלי הגבלה על אורך הרשימה מלכתחילה.
 *
 * הפתרון כאן שונה מהיסוד: כל "עמוד" הוא קומפוננטה נפרדת בגודל A4 מדויק
 * (794×1123px, 96dpi) שנתפסת בנפרד ע"י html2canvas ומודבקת כתמונה
 * שלמה על עמוד PDF משלה (ר' loadPlanReport.js) — אף עמוד לא "נחתך",
 * כי אנחנו קובעים מראש בדיוק כמה שורות נכנסות בכל עמוד (ROWS_PER_PAGE)
 * ופורסים את הנתונים לפי זה, לא אחרי שהתמונה כבר קיימת.
 *
 * עמוד 1 (SummaryPage): "קוביית הסיכום הלוגיסטי" המודגשת — קו, תאריך,
 * לקוחות, ומעל כולם סה"כ הליטרים להעמסה, המספר הכי חשוב בדוח — ועוד
 * טבלת ניחוחים קצרה. עמודים 2+ (DeviceTablePage): טבלת המכשירים
 * המלאה (לקוח, כתובת, דגם, אחוז נוכחי, נדרש למילוי), עמוד בעמוד,
 * עם כותרת/מספור-עמוד חוזרים בכל עמוד.
 */
export const PAGE_W = 794;
export const PAGE_H = 1123;
export const ROWS_PER_PAGE = 24;
// כמה שורות ניחוח עוד "נכנסות" בנוחות לצד קוביית הסיכום בעמוד 1, לפני
// שעדיף לתת לטבלה עמוד ייעודי משלה — נבדק אמפירית מול הגובה הקבוע של
// קוביית הסיכום: 13 שורות זו נקודת-החיתוך המדויקת (13 עדיין נכנס,
// 14 גולש), נבחר 10 כמרווח ביטחון מפני שונות רינדור-פונטים.
export const SCENT_EMBED_THRESHOLD = 10;

const FONT = "'Assistant', -apple-system, 'Segoe UI', sans-serif";

function BrandBar({ big, routeLabel, pageNumber, totalPages }) {
  if (big) {
    return (
      <div style={{
        background: '#0F172A', padding: '26px 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 'none',
      }}>
        <div>
          <div style={{ fontFamily: "'Frank Ruhl Libre', Georgia, serif", fontWeight: 700, fontSize: 28, color: '#FFFFFF', letterSpacing: 0.5 }}>
            ICON AIR
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2, fontWeight: 500 }}>
            מערכת שטח וניהול — הפצת מכשירי ריח
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#FCD34D', textTransform: 'uppercase', letterSpacing: 1 }}>
            דוח העמסה יומי
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{
      background: '#0F172A', padding: '14px 40px', flex: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ fontFamily: "'Frank Ruhl Libre', Georgia, serif", fontWeight: 700, fontSize: 17, color: '#FFFFFF' }}>
        ICON AIR <span style={{ fontFamily: FONT, fontWeight: 500, fontSize: 12.5, color: '#94A3B8' }}>· דוח העמסה</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#FCD34D' }}>{routeLabel}</div>
      <div style={{ fontSize: 12, color: '#94A3B8' }}>עמוד {pageNumber} מתוך {totalPages}</div>
    </div>
  );
}

function PageFooter({ pageNumber, totalPages }) {
  return (
    <div style={{
      flex: 'none', padding: '10px 40px', borderTop: '1px solid #E2E8F0',
      display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94A3B8',
    }}>
      <span>מסמך זה הופק אוטומטית ע״י מערכת ICON AIR</span>
      <span className="tabular">עמוד {pageNumber} מתוך {totalPages}</span>
    </div>
  );
}

/** עמוד 1 — הסיכום הלוגיסטי המודגש (הכי חשוב: סה"כ ליטרים להעמסה) + טבלת ניחוחים. */
export function SummaryPage({
  routeLabel, cycleLabel, viewingNextCycle, technicianName, generatedAt,
  deviceCount, customerCount, items, bufferPct, missingCount, totalPages,
  embedScentTable = true,
}) {
  const totalLiters = items.reduce((sum, i) => sum + i.liters, 0);

  return (
    <div dir="rtl" style={{
      width: PAGE_W, height: PAGE_H, overflow: 'hidden', background: '#FFFFFF', color: '#020617',
      fontFamily: FONT, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    }}>
      <BrandBar big />

      <div style={{ padding: '28px 48px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* קוביית הסיכום הלוגיסטי — הראש של הדוח, לא תוספת בצד */}
        <div style={{
          border: '2px solid #0F172A', borderRadius: 18, padding: '22px 28px', marginBottom: 22,
          background: 'linear-gradient(135deg,#FFFBEB,#FFFFFF)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 18 }}>
            <SummaryStat label="קו הפצה" value={routeLabel} />
            <SummaryStat label="תאריך" value={formatDateTime(generatedAt)} />
            <SummaryStat label="מחזור" value={`${cycleLabel}${viewingNextCycle ? ' (הכנה מוקדמת)' : ''}`} />
            <SummaryStat label="סך לקוחות במסלול" value={customerCount} />
            <SummaryStat label="סך מכשירים" value={deviceCount} />
          </div>
          <div style={{ borderTop: '1px dashed #D97706', paddingTop: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#B45309', textTransform: 'uppercase', letterSpacing: 1 }}>
              סה״כ להעמסה לרכב
            </div>
            <div style={{ fontSize: 56, fontWeight: 800, color: '#0F172A', lineHeight: 1.1, marginTop: 4 }}>
              {totalLiters.toLocaleString('he-IL', { maximumFractionDigits: 1 })}
              <span style={{ fontSize: 26, fontWeight: 700, color: '#B45309' }}> ליטר</span>
            </div>
            {bufferPct > 0 && items.length > 0 && (
              <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 6 }}>
                כולל מרווח ביטחון של <b style={{ color: '#B45309' }}>{bufferPct}%</b> מעבר לחישוב המדויק
              </div>
            )}
          </div>
        </div>

        {missingCount > 0 && (
          <div style={{ marginBottom: 18, padding: '12px 16px', borderRadius: 10, background: '#FEE2E2', fontSize: 13, color: '#7F1D1D' }}>
            {missingCount} מכשירים בלי ניחוח משויך או בלי נפח-מכל מוגדר לדגם — לא נכנסו לחישוב.
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
          לפי ניחוח
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 14, color: '#64748B', padding: '12px 0' }}>כל המכשירים מלאים — אין צורך להעמיס שמן.</div>
        ) : embedScentTable ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #0F172A' }}>
                <th style={cellHead}>ניחוח</th>
                <th style={cellHead}>ליטרים</th>
                <th style={cellHead}>לקיחה מהמדף</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.scent_name} style={{ borderBottom: '1px solid #E2E8F0' }}>
                  <td style={{ ...cell, fontWeight: 700 }}>{row.scent_name}</td>
                  <td style={cell}>{row.liters.toLocaleString('he-IL')} ל׳</td>
                  <td style={{ ...cell, fontWeight: 700, color: '#B45309' }}>{containersLabel(row.liters)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // רשימת ניחוחים ארוכה מדי בשביל עמוד 1 (ר' SCENT_EMBED_THRESHOLD) —
          // מקבלת עמוד/ים ייעודיים משלה מיד אחרי זה, כדי שלעולם לא תיחתך.
          <div style={{ fontSize: 14, color: '#64748B', padding: '10px 0' }}>
            {items.length} ניחוחים שונים — הפירוט המלא בעמוד הבא.
          </div>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748B' }}>
          <span>הופק עבור <b style={{ color: '#0F172A' }}>{technicianName || 'טכנאי ICON AIR'}</b></span>
        </div>
      </div>

      <PageFooter pageNumber={1} totalPages={totalPages} />
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/**
 * עמוד ייעודי לטבלת ניחוחים ארוכה (מעל SCENT_EMBED_THRESHOLD) — אותו
 * מבנה עמוד בדיוק כמו DeviceTablePage (אותו ROWS_PER_PAGE, כי טבלה
 * בת-3-עמודות פשוטה יותר לעולם לא תהיה גבוהה יותר משורת מכשיר מלאה
 * ב-5 עמודות, אז המכסה שכבר נבדקה אמפירית שם בטוחה גם כאן).
 */
export function ScentTablePage({ routeLabel, items, pageNumber, totalPages }) {
  return (
    <div dir="rtl" style={{
      width: PAGE_W, height: PAGE_H, overflow: 'hidden', background: '#FFFFFF', color: '#020617',
      fontFamily: FONT, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    }}>
      <BrandBar routeLabel={routeLabel} pageNumber={pageNumber} totalPages={totalPages} />

      <div style={{ padding: '18px 40px 0', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #0F172A' }}>
              <th style={cellHead}>ניחוח</th>
              <th style={cellHead}>ליטרים</th>
              <th style={cellHead}>לקיחה מהמדף</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.scent_name} style={{ borderBottom: '1px solid #E2E8F0', height: 30 }}>
                <td style={{ ...cell, fontWeight: 700 }}>{row.scent_name}</td>
                <td style={cell}>{row.liters.toLocaleString('he-IL')} ל׳</td>
                <td style={{ ...cell, fontWeight: 700, color: '#B45309' }}>{containersLabel(row.liters)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PageFooter pageNumber={pageNumber} totalPages={totalPages} />
    </div>
  );
}

/** עמוד 2+ — טבלת המכשירים המלאה, ROWS_PER_PAGE שורות מדויק לעמוד. */
export function DeviceTablePage({ routeLabel, rows, pageNumber, totalPages, showRouteColumn }) {
  return (
    <div dir="rtl" style={{
      width: PAGE_W, height: PAGE_H, overflow: 'hidden', background: '#FFFFFF', color: '#020617',
      fontFamily: FONT, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    }}>
      <BrandBar routeLabel={routeLabel} pageNumber={pageNumber} totalPages={totalPages} />

      <div style={{ padding: '18px 40px 0', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '26%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '2px solid #0F172A' }}>
              <th style={cellHead}>לקוח</th>
              <th style={cellHead}>כתובת</th>
              <th style={cellHead}>דגם</th>
              <th style={{ ...cellHead, textAlign: 'center' }}>אחוז נוכחי</th>
              <th style={{ ...cellHead, textAlign: 'center' }}>נדרש (מ״ל)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #E2E8F0', height: 30 }}>
                <td style={{ ...cell, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.customer_name}{showRouteColumn && row.route_name ? ` · ${row.route_name}` : ''}
                </td>
                <td style={{ ...cell, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.address || '—'}</td>
                <td style={cell}>{row.model}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{row.oil_level_pct}%</td>
                <td style={{ ...cell, textAlign: 'center', fontWeight: 700, color: row.needed_ml ? '#B45309' : '#94A3B8' }}>
                  {row.needed_ml != null ? row.needed_ml : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PageFooter pageNumber={pageNumber} totalPages={totalPages} />
    </div>
  );
}

const cellHead = {
  textAlign: 'start', padding: '7px 6px', fontWeight: 700, fontSize: 12,
  color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5,
};
const cell = { textAlign: 'start', padding: '7px 6px' };
