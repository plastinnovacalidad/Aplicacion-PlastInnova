/** Neutral container: white surface, 16px radius, hairline border. */
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  padding?: string;
  /** Lifts 2px and deepens its shadow on hover. */
  interactive?: boolean;
  elevation?: 'none' | 'sm' | 'md' | 'lg';
  bordered?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Card(props: CardProps): JSX.Element;
