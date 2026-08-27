/** Category path above catalogue and product views. */
export interface BreadcrumbItem { label: string; href?: string }
export interface BreadcrumbProps extends Omit<React.HTMLAttributes<HTMLElement>, 'style'> {
  items?: Array<string | BreadcrumbItem>;
  style?: React.CSSProperties;
}
export declare function Breadcrumb(props: BreadcrumbProps): JSX.Element;
