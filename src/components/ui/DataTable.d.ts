import type { ReactNode } from 'react';

export interface Column<T> { key: string; label: ReactNode; width?: string; align?: 'start'; render: (row: T) => ReactNode }
export default function DataTable<T>(props: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; actions?: (row: T) => ReactNode }): JSX.Element;
export function StatusChip(props: { tone?: 'neutral' | 'ok' | 'warn' | 'crit' | 'gold' | 'teal' | 'slate'; children?: ReactNode }): JSX.Element;
export function MiniMeter(props: { value: number; tone?: 'teal' | 'gold' | 'slate' | 'warn' | 'crit' }): JSX.Element;
