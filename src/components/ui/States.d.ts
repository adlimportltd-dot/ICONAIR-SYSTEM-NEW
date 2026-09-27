import type { ReactNode } from 'react';

export function Skeleton(props: { className?: string }): JSX.Element;
export function LoadingRows(props: { rows?: number; height?: string }): JSX.Element;
export function ErrorState(props: { message: ReactNode; onRetry?: () => void }): JSX.Element;
export function EmptyState(props: { title: ReactNode; hint?: ReactNode; action?: ReactNode }): JSX.Element;
export function Async(props: { loading: boolean; error?: string | null; onRetry?: () => void; isEmpty?: boolean; empty?: ReactNode; skeleton?: ReactNode; children?: ReactNode }): JSX.Element;
