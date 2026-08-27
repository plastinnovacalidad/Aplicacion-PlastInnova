/** Titled card that hosts a Chart.js `<canvas>`; keeps every chart on the same frame. */
export interface ChartPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'style'> {
  title?: string;
  subtitle?: string;
  /** Right-aligned control, usually a Select or a pill Tabs. */
  action?: React.ReactNode;
  /** Canvas area height in px. */
  height?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function ChartPanel(props: ChartPanelProps): JSX.Element;
/** Brand-ordered series palette for Chart.js datasets. */
export declare const CHART_COLORS: string[];
