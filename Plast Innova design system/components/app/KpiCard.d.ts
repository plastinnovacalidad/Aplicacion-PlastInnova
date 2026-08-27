/**
 * Headline figure for report dashboards — the number is set in the data font.
 */
export interface KpiCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  label?: string;
  value?: React.ReactNode;
  /** Small suffix after the figure, e.g. "%" or "uds". */
  unit?: string;
  /** FontAwesome slug without the `fa-` prefix. */
  icon?: string;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'info';
  /** Percentage change; positive renders green with an up arrow. */
  delta?: number;
  deltaLabel?: string;
  style?: React.CSSProperties;
}
export declare function KpiCard(props: KpiCardProps): JSX.Element;
