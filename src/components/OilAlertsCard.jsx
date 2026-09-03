import GlassCard, { CardHead } from './ui/GlassCard';

/** ככל שהמכל ריק יותר, המד אדום יותר — הצבע נגזר מהמספר, לא מוגדר ידנית */
function levelFill(level) {
  if (level <= 10) return 'linear-gradient(90deg,#F0555C,#FF8B90)';
  if (level <= 13) return 'linear-gradient(90deg,#F0555C,#F0A43A)';
  if (level <= 16) return 'linear-gradient(90deg,#F0A43A,#F5C078)';
  return 'linear-gradient(90deg,#F0A43A,#C5A059)';
}

export default function OilAlertsCard({ delay, alerts = [], onAssignAll }) {
  return (
    <GlassCard delay={delay}>
      <CardHead title="התראות מלאי שמן" subtitle="מכשירים מתחת ל-20%" />

      <div className="flex flex-col gap-3.5">
        {alerts.map((alert) => (
          <div key={alert.deviceId}>
            <div className="flex items-baseline gap-2">
              <span className="text-[13.5px] font-semibold">{alert.client}</span>
              <span className="ms-auto font-mono text-[11px] text-text-faint">{alert.deviceId}</span>
            </div>

            <div className="meter">
              <span style={{ width: `${alert.level}%`, background: levelFill(alert.level) }} />
            </div>

            <div className="mt-[7px] flex justify-between text-[11.5px] text-text-faint">
              <span>{alert.scent}</span>
              <b className="tabular font-semibold text-text-dim">
                {alert.level}% · {alert.note}
              </b>
            </div>
          </div>
        ))}

        <button type="button" onClick={onAssignAll} className="ghost-btn mt-0.5 w-full text-center">
          שבץ את כל ההתראות לקו הפצה
        </button>
      </div>
    </GlassCard>
  );
}
