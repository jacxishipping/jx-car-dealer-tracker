import {type JXTextFieldProps} from '@jacxishippingorg/jx-ui-react'

import {JXTextField} from './JXUI'
/** Keep ordinary form fields focused on entry; counters and clear buttons are opt-in. */
export function AppTextField(props: JXTextFieldProps) {
  return <JXTextField {...props} clearable={false} showCharacterCounter={false} showEntropyMeter={false} />
}
