/** Square 20px checkbox with a Lucide check; controlled or uncontrolled. */
export interface CheckboxProps {
  label?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
