/**
 * Primary action control for Plast Innova surfaces.
 */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** primary = institutional blue, accent = red CTA gradient, secondary = blue outline. */
  variant?: 'primary' | 'accent' | 'secondary' | 'subtle' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  /** Lucide slug rendered before the label. */
  iconLeft?: string;
  /** Lucide slug rendered after the label. */
  iconRight?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): JSX.Element;
