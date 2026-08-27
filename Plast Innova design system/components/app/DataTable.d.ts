/** Dense report table with an uppercase header band, zebra rows and a blue hover row. */
export interface DataTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  /** Custom cell renderer, e.g. to return a Badge. */
  render?: (value: any, row: Record<string, any>) => React.ReactNode;
}
export interface DataTableProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  columns?: DataTableColumn[];
  rows?: Array<Record<string, any>>;
  zebra?: boolean;
  emptyLabel?: string;
  style?: React.CSSProperties;
}
export declare function DataTable(props: DataTableProps): JSX.Element;
