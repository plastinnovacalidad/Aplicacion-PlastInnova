/** Horizontal section switcher; underline (red indicator) or pill variant. */
export interface TabItem { value: string; label: string }
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'style'> {
  items?: Array<string | TabItem>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  variant?: 'underline' | 'pill';
  style?: React.CSSProperties;
}
export declare function Tabs(props: TabsProps): JSX.Element;
