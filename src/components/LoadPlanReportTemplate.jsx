import { containersLabel, formatDateTime } from '../lib/mappers';

/**
 * תבנית דוח "מה להעמיס היום" — אותה שיטה בדיוק כמו ServiceReportTemplate
 * (ר' src/lib/loadPlanReport.js): מרונדרת אמיתית ב-DOM ונלכדת ע"י
 * html2canvas, כדי שעברית/RTL ייצאו נכון בלי הטמעת פונט ידנית ב-jsPDF.
 * רוחב קבוע 794px = A4 ב-96dpi.
 */
export default function LoadPlanReportTemplate({
  routeLabel, cycleLabel, viewingNextCycle, technicianName, generatedAt,
  deviceCount, items, bufferPct, missingCount, newDevices, showRouteColumn,
}) {
  const totalLiters = items.reduce((sum, i) => sum + i.liters, 0);

  return (
    <div
      dir="rtl"
      style={{
        width: 794,
        minHeight: 1000,
        background: '#FFFFFF',
        color: '#020617',
        fontFamily: "'Assistant', -apple-system, 'Segoe UI', sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <div style={{
        background: '#0F172A', padding: '28px 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontFamily: "'Frank Ruhl Libre', Georgia, serif",
            fontWeight: 700, fontSize: 30, color: '#FFFFFF', letterSpacing: 0.5,
          }}>
            ICON AIR
          </div>
          <div style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 2, fontWeight: 500 }}>
            מערכת שטח וניהול — הפצת מכשירי ריח
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontSize: 13, fontWeight: 800, color: '#FCD34D',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            דוח העמסה יומי
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
            {formatDateTime(generatedAt)}
          </div>
        </div>
      </div>

      <div style={{ padding: '32px 48px' }}>
        {/* כותרת קו + מחזור */}
        <div style={{
          border: '1px solid #CBD5E1', borderRadius: 14, padding: '20px 24px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
              letterSpacing: 0.8, marginBottom: 6,
            }}>
              קו הפצה
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{routeLabel}</div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{
              fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
              letterSpacing: 0.8, marginBottom: 6,
            }}>
              מחזור
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {cycleLabel}{viewingNextCycle ? ' (הכנה מוקדמת)' : ''}
            </div>
          </div>
        </div>

        {/* סיכום מספרי */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{
            flex: 1, textAlign: 'center', border: '1px solid #CBD5E1', borderRadius: 14, padding: '16px 12px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              מכשירים
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{deviceCount}</div>
          </div>
          <div style={{
            flex: 1, textAlign: 'center', border: '1px solid #CBD5E1', borderRadius: 14, padding: '16px 12px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              סה״כ שמן להעמיס
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4, color: '#B45309' }}>
              {totalLiters.toLocaleString('he-IL', { maximumFractionDigits: 1 })} ל׳
            </div>
          </div>
        </div>

        {bufferPct > 0 && items.length > 0 && (
          <div style={{
            marginBottom: 20, padding: '12px 16px', borderRadius: 10,
            background: '#FEF3C7', fontSize: 13, color: '#334155',
          }}>
            הכמויות כוללות מרווח ביטחון של <b style={{ color: '#B45309' }}>{bufferPct}%</b> מעבר לחישוב המדויק.
          </div>
        )}

        {/* טבלת ניחוחים */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
            letterSpacing: 0.8, marginBottom: 10,
          }}>
            לפי ניחוח
          </div>
          {items.length === 0 ? (
            <div style={{ fontSize: 14, color: '#64748B', padding: '12px 0' }}>
              כל המכשירים מלאים — אין צורך להעמיס שמן.
            </div>
          ) : (
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
          )}
        </div>

        {missingCount > 0 && (
          <div style={{
            marginBottom: 20, padding: '12px 16px', borderRadius: 10,
            background: '#FEE2E2', fontSize: 13, color: '#7F1D1D',
          }}>
            {missingCount} מכשירים בלי ניחוח משויך או בלי נפח-מכל מוגדר לדגם — לא נכנסו לחישוב.
          </div>
        )}

        {newDevices.length > 0 && (
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
              letterSpacing: 0.8, marginBottom: 10,
            }}>
              מכשירים חדשים להתקנה ({newDevices.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #0F172A' }}>
                  <th style={cellHead}>לקוח</th>
                  <th style={cellHead}>כתובת</th>
                  <th style={cellHead}>דגם</th>
                  {showRouteColumn && <th style={cellHead}>קו</th>}
                </tr>
              </thead>
              <tbody>
                {newDevices.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <td style={{ ...cell, fontWeight: 700 }}>{d.customer_name}</td>
                    <td style={cell}>{d.address || '—'}</td>
                    <td style={cell}>{d.model}</td>
                    {showRouteColumn && <td style={cell}>{d.route_name || '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 18, marginTop: 24, borderTop: '2px solid #0F172A',
        }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>הופק עבור</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{technicianName || 'טכנאי ICON AIR'}</div>
          </div>
          <div style={{ fontSize: 11.5, color: '#94A3B8', textAlign: 'left' }}>
            מסמך זה הופק אוטומטית ע״י מערכת ICON AIR
          </div>
        </div>
      </div>
    </div>
  );
}

const cellHead = {
  textAlign: 'start', padding: '8px 6px', fontWeight: 700, fontSize: 12.5,
  color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5,
};
const cell = { textAlign: 'start', padding: '9px 6px' };
