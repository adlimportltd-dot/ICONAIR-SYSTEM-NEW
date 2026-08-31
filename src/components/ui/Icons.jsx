/**
 * סט אייקונים פנימי — SVG בקו דק, בלי תלות בספרייה חיצונית.
 * כל אייקון יורש currentColor, כך שצביעה נעשית דרך Tailwind (text-gold-300 וכו').
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function GridIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </svg>
  );
}

export function DeviceIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="3.5" />
      <path d="M10 6.5h4" />
      <circle cx="12" cy="14" r="2.6" />
    </svg>
  );
}

export function UsersIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M18 14.6c2 .7 3.2 2.4 3.2 4.9" />
    </svg>
  );
}

export function DropIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2.8s5.6 6 5.6 10a5.6 5.6 0 1 1-11.2 0c0-4 5.6-10 5.6-10Z" />
      <path d="M9.2 14.4a2.9 2.9 0 0 0 2.8 2.8" />
    </svg>
  );
}

export function WrenchIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 4.2a4.6 4.6 0 0 1 5.3 6.3l-9 9a2.6 2.6 0 0 1-3.7-3.7l9-9" />
      <path d="M4.2 14.5 9 9.7" />
    </svg>
  );
}

export function ChartIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 20V9M12 20V4M19 20v-7" />
    </svg>
  );
}

export function RouteIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M6 8.6V13a4 4 0 0 0 4 4h4" />
      <path d="M15.5 15.5 17 17l1.5-1.5" />
    </svg>
  );
}

export function NavigationIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m3 11 18-8-8 18-2.5-7.5L3 11Z" />
    </svg>
  );
}

export function ChevronDownIcon(props) {
  return (
    <svg {...base} strokeWidth={2} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function BoxIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 8.2 12 3.5l8.5 4.7v8.6L12 21.5l-8.5-4.7Z" />
      <path d="M3.5 8.2 12 12.9l8.5-4.7M12 12.9v8.6" />
    </svg>
  );
}

export function TagIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M11.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.5c0 .4.16.78.44 1.06l9 9a1.5 1.5 0 0 0 2.12 0l6.5-6.5a1.5 1.5 0 0 0 0-2.12l-9-9a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8.3" cy="8.3" r="1.6" />
    </svg>
  );
}

export function PrinterIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 8.5V3.5h11v5" />
      <rect x="4" y="8.5" width="16" height="8" rx="2" />
      <path d="M6.5 15.5v5h11v-5" />
      <circle cx="17" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SettingsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <svg {...base} strokeWidth={1.8} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function BellIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5Z" />
      <path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function PlusIcon(props) {
  return (
    <svg {...base} strokeWidth={1.9} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowUpIcon(props) {
  return (
    <svg {...base} strokeWidth={2.4} {...props}>
      <path d="m5 15 7-7 7 7" />
    </svg>
  );
}

export function ArrowDownIcon(props) {
  return (
    <svg {...base} strokeWidth={2.4} {...props}>
      <path d="m5 9 7 7 7-7" />
    </svg>
  );
}

/** לוגו ICON AIR — שלושה זרמי אוויר מתפתלים */
export function AirMarkIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" {...props}>
      <path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5" />
      <path d="M3 12h14a3 3 0 1 1-3 3" />
      <path d="M3 16h8.5a2.5 2.5 0 1 1-2.5 2.5" />
    </svg>
  );
}

/** מיפוי שם→קומפוננטה, כדי שנתוני הניווט יוכלו להחזיק מחרוזת בלבד */
export const iconMap = {
  grid: GridIcon,
  device: DeviceIcon,
  users: UsersIcon,
  drop: DropIcon,
  wrench: WrenchIcon,
  chart: ChartIcon,
  settings: SettingsIcon,
  route: RouteIcon,
  box: BoxIcon,
  tag: TagIcon,
};
