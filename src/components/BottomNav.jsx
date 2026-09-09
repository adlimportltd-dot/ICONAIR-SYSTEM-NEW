import { navItems } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { iconMap } from './ui/Icons';

/**
 * ניווט תחתון מרחף — הכלי הראשי של הטכנאי בשטח.
 * מוצג עד רוחב 1080px; מעליו מופיע Sidebar במקומו.
 * 2026-09-09 Full Design Overhaul #2: "שבב כהה" נייבי, תואם ל-Sidebar/TopBar
 * (ר' הערה ב-Sidebar.jsx) — במקום הזכוכית-הלבנה-שקופה הקודמת.
 */
export default function BottomNav({ activeId, onSelect, criticalCalls = 0 }) {
  const { isAdmin } = useAuth();
  const tabs = navItems.filter((item) => item.inTabBar && (!item.adminOnly || isAdmin));

  return (
    <nav
      aria-label="ניווט מהיר"
      className="fixed inset-x-3 bottom-3 z-30 flex justify-between gap-0.5
                 rounded-[22px] border border-white/[0.08] px-1.5 py-2 lg:hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(15,23,42,.97), rgba(2,6,23,.98))',
        backdropFilter: 'blur(26px)',
        WebkitBackdropFilter: 'blur(26px)',
        boxShadow: '0 22px 44px -18px rgba(2,6,23,.5), inset 0 1px 0 rgba(255,255,255,.06)',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
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
            className={`relative flex flex-1 flex-col items-center gap-[5px] rounded-[15px] px-0.5 py-2
                        text-[12.5px] font-bold transition-colors
                        ${isActive ? 'bg-amber-500/[0.16] text-amber-400' : 'text-slate-400'}`}
          >
            <Icon className="h-5 w-5" />
            {item.shortLabel}
            {badge > 0 && (
              <span className="tabular absolute end-[18%] top-1 min-w-[16px] rounded-full bg-crit
                               px-1 font-mono text-[9.5px] leading-4 text-white">
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
