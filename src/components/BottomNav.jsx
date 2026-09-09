import { navItems } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { iconMap } from './ui/Icons';

/**
 * ניווט תחתון מרחף — הכלי הראשי של הטכנאי בשטח.
 * מוצג עד רוחב 1080px; מעליו מופיע Sidebar במקומו.
 *
 * 2026-09-09 (דרישה קריטית, "בדיוק לפי העבודה בשטח"): **בדיוק 4 כפתורים**
 * — מסלולים, לקוחות, הכנה לקו (= מסך "מלאי נייד" עם `shortLabel` ייעודי
 * לניווט התחתון), קריאות שירות — לפי `tabBarOrder` ב-`navigation.js`, לא
 * לפי סדר ההופעה בסרגל הצד. דשבורד/מכשירים/שמנים ירדו מהניווט התחתון
 * (עדיין נגישים מהסרגל הצד בדסקטופ) כדי שלא יהיה עומס-יתר על המסך הקטן.
 * מצב פעיל = עיגול/גלולה **מלא** בזהב (לא שקוף-חלקי) עם טקסט כהה עליו —
 * אותו דפוס "טקסט כהה על גבי זהב מלא" שנשמר בעקביות בכל הכפתורים
 * הראשיים במערכת (`PrimaryButton`).
 */
export default function BottomNav({ activeId, onSelect, criticalCalls = 0 }) {
  const { isAdmin } = useAuth();
  const tabs = navItems
    .filter((item) => item.inTabBar && (!item.adminOnly || isAdmin))
    .sort((a, b) => a.tabBarOrder - b.tabBarOrder);

  return (
    <nav
      aria-label="ניווט מהיר"
      className="fixed inset-x-3 bottom-3 z-30 flex justify-between gap-2
                 rounded-[22px] border border-white/[0.08] px-2 py-2.5 lg:hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(15,23,42,.97), rgba(2,6,23,.98))',
        backdropFilter: 'blur(26px)',
        WebkitBackdropFilter: 'blur(26px)',
        boxShadow: '0 22px 44px -18px rgba(2,6,23,.5), inset 0 1px 0 rgba(255,255,255,.06)',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
      }}
    >
      {tabs.map((item) => {
        const Icon = iconMap[item.icon];
        const isActive = item.id === activeId;
        const badge = item.id === 'service' ? criticalCalls : 0;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-[6px]
                        rounded-[16px] px-1 py-2.5 text-[12.5px] font-bold leading-none
                        transition-colors ${
                          isActive
                            ? 'bg-amber-500 text-slate-950 shadow-gold-glow'
                            : 'text-slate-400 active:bg-white/[0.06]'
                        }`}
          >
            <Icon className="h-6 w-6 flex-none" />
            <span className="whitespace-nowrap">{item.shortLabel}</span>
            {badge > 0 && (
              <span className="tabular absolute end-[14%] top-1.5 min-w-[17px] rounded-full bg-crit
                               px-1 font-mono text-[10px] font-bold leading-[17px] text-white
                               ring-2 ring-navy-900">
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
