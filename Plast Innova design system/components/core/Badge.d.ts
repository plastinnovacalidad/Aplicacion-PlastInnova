/** Small uppercase status/marketing pill. */
export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'style'> {
  tone?: 'brand' | 'accent' | 'neutral' | 'success' | 'warning' | 'info';
  /** Filled instead of tinted. */
  solid?: boolean;
  icon?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;
