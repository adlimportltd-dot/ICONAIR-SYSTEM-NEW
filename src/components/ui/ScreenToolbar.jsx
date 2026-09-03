import { SearchIcon, PlusIcon } from './Icons';
import { Select } from './Field';

/**
 * שורת הכלים שחוזרת בכל מסך ניהול: חיפוש, מסננים, ספירת תוצאות
 * וכפתור ההוספה. בנייד היא נערמת לשתי שורות במקום להידחס.
 */
export default function ScreenToolbar({
  search,
  onSearch,
  searchPlaceholder = 'חיפוש…',
  filters = [],
  count,
  countLabel = 'תוצאות',
  actionLabel,
  onAction,
  extra,
}) {
  return (
    <div className="glass mb-3.5 flex flex-wrap items-center gap-2.5 rounded-panel p-3">
      <div className="relative flex min-w-[190px] flex-1 items-center">
        <SearchIcon className="pointer-events-none absolute end-3.5 h-4 w-4 text-text-faint" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-pill border border-white/[0.09] bg-black/30 py-2.5 pe-10 ps-3.5
                     text-[13.5px] text-text placeholder:text-text-faint
                     focus:border-gold-500/45 focus:outline-none"
        />
      </div>

      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={filter.value}
          onChange={(event) => filter.onChange(event.target.value)}
          options={filter.options}
          placeholder={filter.placeholder}
          className="!w-auto min-w-[132px] !py-2.5 text-[13px]"
          aria-label={filter.placeholder}
        />
      ))}

      {extra}

      {count != null && (
        <span className="tabular hidden text-[12.5px] text-text-faint md:inline">
          {count.toLocaleString('he-IL')} {countLabel}
        </span>
      )}

      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="ms-auto flex items-center gap-1.5 rounded-pill px-3.5 py-2.5
                     text-[13.5px] font-semibold text-[#221B0C] transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(150deg, #D4AF37, #C5A059)' }}
        >
          <PlusIcon className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
