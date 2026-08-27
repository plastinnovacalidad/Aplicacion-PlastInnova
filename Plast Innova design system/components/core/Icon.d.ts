/** FontAwesome 6 glyph sized to a square box and tinted with currentColor. */
export interface IconProps extends React.HTMLAttributes<HTMLElement> {
  /** FontAwesome slug WITHOUT the `fa-` prefix, e.g. "lightbulb", "cart-shopping". */
  name?: string;
  /** Pixel box for the glyph; the glyph itself renders at 88% of it. */
  size?: number;
  /** FontAwesome style family. Use "brands" for logos. */
  variant?: 'solid' | 'regular' | 'brands';
}
export declare function Icon(props: IconProps): JSX.Element;
