import { JXTextField, type JXTextFieldProps } from '@jacxishippingorg/jx-ui-react'

/** Keep ordinary form fields focused on entry; counters and clear buttons are opt-in. */
export function AppTextField(props: JXTextFieldProps) {
  return <JXTextField {...props} clearable={false} showCharacterCounter={false} showEntropyMeter={false} />
}
