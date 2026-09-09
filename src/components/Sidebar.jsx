import { useState } from 'react';
import { navItems, settingsNavItem } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { iconMap, AirMarkIcon } from './ui/Icons';
import { brandLogoUrl, BRAND_LOGO_EXT_FALLBACK } from '../lib/queries';

/**
 * מנסה לטעון את הלוגו שהמנהל העלה (מסך הגדרות → מיתוג), עובר על
 * סיומות הקובץ האפשריות בזו אחר זו. אם אף אחת לא נטענת (לא הועלה
 * לוגו בכלל) — נופל חזרה לסמל+טקסט המובנה של המערכת.
 */
function BrandLogo({ compact, overrideSrc, dark }) {
  const [extIndex, setExtIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (failed) return <BuiltInMark compact={compact} dark={dark} />;

  return (
    <img
      src={overrideSrc ?? brandLogoUrl(BRAND_LOGO_EXT_FALLBACK[extIndex])}
      alt="ICON AIR"
      className={compact ? 'h-11 max-w-[220px] object-contain' : 'h-12 max-w-[240px] object-contain'}
      onError={() => {
        if (overrideSrc) { setFailed(true); return; }
        if (extIndex + 1 < BRAND_LOGO_EXT_FALLBACK.length) setExtIndex(extIndex + 1);
        else setFailed(true);
      }}
    />
  );
}

function BuiltInMark({ compact, dark = false }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'px-1.5 pt-0.5'}`}>
      <div
        className="grid h-10 w-10 flex-none place-items-center rounded-pill border border-amber-400/35 text-amber-400"
        style={{
          background: 'linear-gradient(150deg, rgba(245,158,11,.30), rgba(245,158,11,.06))',
          boxShadow: '0 8px 22px -12px rgba(245,158,11,.6), inset 0 1px 0 rgba(255,255,255,.16)',
        }}
      >
        <AirMarkIcon className="h-[21px] w-[21px]" />
      </div>
      <div>
        <div className={`font-display text-[19px] font-bold leading-none tracking-wide ${dark ? 'text-white' : 'text-text'}`}>ICON AIR</div>
        <div className={`mt-1 font-mono text-[13px] tracking-[1.6px] ${dark ? 'text-slate-400' : 'text-text-faint'}`}>FIELD OPS</div>
      </div>
    </div>
  );
}

/**
 * לוגו + שם המערכת. משמש בסרגל הצד (dark), בשורה העליונה בנייד (dark)
 * ובמסך ההתחברות (light — `dark` נשאר false שם).
 */
export function Brand({ compact = false, overrideSrc, dark = false }) {
  return <BrandLogo compact={compact} overrideSrc={overrideSrc} dark={dark} />;
}

/**
 * פריט ניווט על גבי הסרגל הכהה — 2026-09-09 Full Design Overhaul #2:
 * הסרגל עצמו עבר לנייבי עמוק, אז כל הטקסט/הובר כאן הם ליטרלים בהירים
 * (slate-300/white), לא טוקני `text-*` הרגילים (מכוונים לרקע לבן). מצב
 * פעיל = ענבר בוהק (amber-400 טקסט, amber-500/15 רקע) — נוכח וברור על
 * גבי הכהה, בלי הצורך בגרדיאנט ידני.
 */
function NavItem({ item, isActive, badge, onSelect }) {
  const Icon = iconMap[item.icon];

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={isActive ? 'page' : undefined}
      className={`relative flex w-full items-center gap-3 rounded-pill px-3 py-[11px]
                  text-[14.5px] transition-colors
                  ${isActive ? 'bg-amber-500/15 font-bold text-amber-400' : 'font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-white'}`}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute -start-4 top-1/2 h-[22px] w-[3.5px] -translate-y-1/2 rounded-[3px]
                     bg-amber-400 shadow-gold-glow"
        />
      )}
      <Icon className={`h-[19px] w-[19px] flex-none ${isActive ? 'opacity-100' : 'opacity-80'}`} />
      {item.label}
      {badge > 0 && (
        <span className="tabular ms-auto rounded-full bg-crit px-[7px] py-0.5 font-mono text-[13px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * סרגל צד מרחף — מוצג מרוחב 1080px ומעלה. בנייד מחליף אותו BottomNav.
 * 2026-09-09 Full Design Overhaul #2: "שבב כהה" — נייבי עמוק (bg-navy-900),
 * לא זכוכית-לבנה כמו שאר המערכת. זה החריג התיעודי היחיד ל"אין רקעים
 * כהים" — ר' "שתי משפחות שבב" ב-CLAUDE.md. תוכן המסך עצמו (הימין) נשאר
 * לבן טהור כרגיל.
 */
export default function Sidebar({ activeId, onSelect, criticalCalls = 0 }) {
  const { profile, isAdmin } = useAuth();
  const initials = (profile?.full_name ?? '?').trim().charAt(0);

  // דוחות חושפים סיכומים ומספרים על כלל העסק — רק מנהל אמור לראות את
  // הלשונית הזו בתפריט. ה-RLS כבר מגן על הנתונים עצמם; זה חוסם רק את התצוגה.
  const visibleNavItems = isAdmin ? navItems : navItems.filter((item) => item.id !== 'reports');

  return (
    <aside
      className="fixed inset-y-[18px] start-[18px] z-20 hidden w-[264px] flex-col gap-[22px]
                 rounded-card border border-white/[0.06] bg-navy-900 px-4 py-[22px] shadow-lift lg:flex"
      aria-label="ניווט ראשי"
    >
      <Brand dark />

      <nav className="flex flex-col gap-1">
        <div className="px-2.5 pb-2 text-[12.5px] font-bold tracking-[2px] text-slate-500">
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

        <div className="flex items-center gap-[11px] rounded-[15px] border border-white/[0.06] bg-white/[0.04] p-[11px]">
          <div
            className="grid h-9 w-9 flex-none place-items-center rounded-[11px]
                       bg-gold-500 font-display text-[15px] font-extrabold text-slate-950"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold leading-tight text-white">
              {profile?.full_name ?? 'טוען…'}
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-slate-400">
              {isAdmin ? 'מנהל תפעול' : 'טכנאי שטח'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
