/** Native select styled to match Input, with a chevron affordance. */
export interface SelectOption { value: string; label: string }
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'style'> {
  label?: string;
  hint?: string;
  options?: Array<string | SelectOption>;
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
}
export declare function Select(props: SelectProps): JSX.Element;
