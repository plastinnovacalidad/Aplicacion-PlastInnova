/** Filter / attribute chip; selectable and optionally removable. */
export interface TagProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'style'> {
  selected?: boolean;
  onRemove?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Tag(props: TagProps): JSX.Element;
