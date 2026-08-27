/** Square launcher tile for a portal module: full-bleed icon panel over a centred label. */
export interface ModuleTileProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'style'> {
  /** FontAwesome slug without the `fa-` prefix. */
  icon?: string;
  label?: string;
  /** Any CSS background for the icon panel — use a brand gradient token. */
  tone?: string;
  /** Tile width; the icon panel is square at this size. */
  size?: number;
  style?: React.CSSProperties;
}
export declare function ModuleTile(props: ModuleTileProps): JSX.Element;
