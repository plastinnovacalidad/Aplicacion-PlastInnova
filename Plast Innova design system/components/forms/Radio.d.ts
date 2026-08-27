/** Single-choice control; drive a group by sharing `name` and lifting state. */
export interface RadioProps {
  label?: string;
  checked?: boolean;
  onChange?: (value?: string) => void;
  name?: string;
  value?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Radio(props: RadioProps): JSX.Element;
