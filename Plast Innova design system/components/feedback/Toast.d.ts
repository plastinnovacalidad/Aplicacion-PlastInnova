/** Transient confirmation card, bottom-right. */
export interface ToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'style'> {
  tone?: 'success' | 'danger' | 'info' | 'warning';
  title?: string;
  message?: string;
  onClose?: () => void;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;
