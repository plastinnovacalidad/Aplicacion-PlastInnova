/** Dark blue label revealed on hover; wraps its trigger. */
export interface TooltipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'content' | 'style'> {
  content?: React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Tooltip(props: TooltipProps): JSX.Element;
