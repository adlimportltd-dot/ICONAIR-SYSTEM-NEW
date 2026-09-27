import type { ComponentType, ReactNode, ElementType } from 'react';

type Tone = 'gold' | 'teal' | 'ok' | 'crit' | 'slate';

export default function GlassCard(props: { children?: ReactNode; className?: string; delay?: number; as?: ElementType }): JSX.Element;
export function CardHead(props: {
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
}): JSX.Element;
export function Swatch(props: { style?: React.CSSProperties; className?: string }): JSX.Element;
