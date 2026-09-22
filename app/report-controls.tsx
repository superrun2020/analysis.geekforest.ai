import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Select, DatePicker, type SelectProps } from 'antd';
import dayjs from 'dayjs';

/** ISO date boundary stays unchanged for report queries; clearing cannot issue an empty query. */
export function ReportDate({ value, min, max, onChange, ...props }: { value: string; min?: string; max?: string; onChange?: (value: string) => void; title?: string; 'aria-label'?: string; className?: string; disabled?: boolean }) {
 return <DatePicker {...props} value={value ? dayjs(value) : null} minDate={min ? dayjs(min) : undefined} maxDate={max ? dayjs(max) : undefined} allowClear={false} format="YYYY-MM-DD" inputReadOnly onChange={date => { if (date) onChange?.(date.format('YYYY-MM-DD')); }} />;
}

function selectOptions(children: ReactNode): NonNullable<SelectProps<string>['options']> {
 return Children.toArray(children).flatMap(child => {
  if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode; label?: string }>(child)) return [];
  if (child.type === Fragment) return selectOptions(child.props.children);
  if (child.type === 'optgroup') return [{ label: child.props.label, options: selectOptions(child.props.children) }];
  if (child.type !== 'option') return [];
  const label = Children.toArray(child.props.children).join('');
  return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }];
 });
}
/** Report-only selector. Uses AntD's value callback; does not emulate DOM events. */
export function ReportSelect({ children, style, ...props }: Omit<SelectProps<string>, 'children' | 'options'> & { children?: ReactNode }) {
 return <Select<string> {...props} style={{ minWidth: 120, maxWidth: '100%', ...style }} options={selectOptions(children)} />;
}
