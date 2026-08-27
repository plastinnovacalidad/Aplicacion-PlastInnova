/** Labelled single-line text field with optional leading icon, hint and error. */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'style'> {
  label?: string;
  hint?: string;
  /** Replaces the hint and turns the field red. */
  error?: string;
  iconLeft?: string;
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;
