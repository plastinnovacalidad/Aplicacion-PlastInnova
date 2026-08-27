/** Centred modal over a blurred blue scrim. Positions absolutely — give its parent `position:relative`. */
export interface DialogProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'style'> {
  open?: boolean;
  title?: string;
  description?: string;
  onClose?: () => void;
  /** Usually a pair of Buttons. */
  footer?: React.ReactNode;
  width?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Dialog(props: DialogProps): JSX.Element | null;
