import { navItems, settingsNavItem } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { iconMap, AirMarkIcon } from './ui/Icons';

/** לוגו + שם המערכת. משמש בסרגל הצד, בשורה העליונה בנייד ובמסך ההתחברות. */
export function Brand({ compact = false }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'px-1.5 pt-0.5'}`}>
      <div
        className="grid h-10 w-10 flex-none place-items-center rounded-pill border border-gold-500/35 text-gold-300"
        style={{
          background: 'linear-gradient(150deg, rgba(216,179,106,.30), rgba(216,179,106,.05))',
          boxShadow: '0 8px 22px -12px rgba(216,179,106,.6), inset 0 1px 0 rgba(255,255,255,.16)',
        }}
      >
        <AirMarkIcon className="h-[21px] w-[21px]" />
      </div>
      <div>
        <div className="font-display text-[19px] font-bold leading-none tracking-wide">ICON AIR</div>
        <div className="mt-1 font-mono text-[11px] tracking-[1.6px] text-text-faint">FIELD OPS</div>
      </div>
    </div>
  );
}

/** פריט ניווט — כולל פס הזהב שמסמן את המסך הפעיל */
function NavItem({ item, isActive, badge, onSelect }) {
  const Icon = iconMap[item.icon];

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={isActive ? 'page' : undefined}
      className={`relative flex w-full items-center gap-3 rounded-pill px-3 py-[11px]
                  text-[14.5px] font-medium transition-colors
                  ${isActive ? 'text-gold-300' : 'text-text-dim hover:bg-white/[0.045] hover:text-text'}`}
      style={
        isActive
          ? { background: 'linear-gradient(270deg, rgba(216,179,106,.14), rgba(216,179,106,.02))' }
          : undefined
      }
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute -start-4 top-1/2 h-[22px] w-[3px] -translate-y-1/2 rounded-[3px]
                     bg-gold-500 shadow-gold-glow"
        />
      )}
      <Icon className={`h-[19px] w-[19px] flex-none ${isActive ? 'opacity-100' : 'opacity-85'}`} />
      {item.label}
      {badge > 0 && (
        <span className="tabular ms-auto rounded-full border border-crit/30 bg-crit/15 px-[7px] py-0.5
                         font-mono text-[11px] text-crit-soft">
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * סרגל צד מרחף — מוצג מרוחב 1080px ומעלה.
 * בנייד מחליף אותו BottomNav.
 */
export default function Sidebar({ activeId, onSelect, criticalCalls = 0 }) {
  const { profile, isAdmin } = useAuth();
  const initials = (profile?.full_name ?? '?').trim().charAt(0);

  // דוחות חושפים סיכומים ומספרים על כלל העסק — רק מנהל אמור לראות את
  // הלשונית הזו בתפריט. ה-RLS כבר מגן על הנתונים עצמם; זה חוסם רק את התצוגה.
  const visibleNavItems = isAdmin ? navItems : navItems.filter((item) => item.id !== 'reports');

  return (
    <aside
      className="fixed inset-y-[18px] start-[18px] z-20 hidden w-[252px] flex-col gap-[22px]
                 rounded-card px-4 py-[22px] glass shadow-lift lg:flex"
      aria-label="ניווט ראשי"
    >
      <Brand />

      <nav className="flex flex-col gap-1">
        <div className="px-2.5 pb-2 text-[10.5px] font-semibold tracking-[2px] text-text-faint">
          ניהול
        </div>
        {visibleNavItems.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            badge={item.id === 'service' ? criticalCalls : 0}
            onSelect={onSelect}
          />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-3.5">
        <NavItem
          item={settingsNavItem}
          isActive={settingsNavItem.id === activeId}
          onSelect={onSelect}
        />

        <div className="inner-row flex items-center gap-[11px] rounded-[15px] bg-white/[0.03] p-[11px]">
          <div
            className="grid h-9 w-9 flex-none place-items-center rounded-[11px]
                       font-display text-[15px] font-bold text-[#221B0C]"
            style={{ background: 'linear-gradient(150deg, #F0DCB4, #D8B36A)' }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold leading-tight">
              {profile?.full_name ?? 'טוען…'}
            </div>
            <div className="mt-0.5 text-[11.5px] text-text-faint">
              {isAdmin ? 'מנהל תפעול' : 'טכנאי שטח'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
