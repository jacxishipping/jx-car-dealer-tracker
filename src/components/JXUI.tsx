import type { ComponentProps } from 'react'
import {
  JXAlert as LibraryAlert,
  JXAvatar as LibraryAvatar,
  JXAvatarGroup as LibraryAvatarGroup,
  JXButton as LibraryButton,
  JXButtonGroup as LibraryButtonGroup,
  JXCard as LibraryCard,
  JXChip as LibraryChip,
  JXProgress as LibraryProgress,
  JXSelect as LibrarySelect,
  JXSwitch as LibrarySwitch,
  JXTextField as LibraryTextField,
  JXTimeline as LibraryTimeline,
  JXStepper as LibraryStepper,
  JXNumberField as LibraryNumberField,
  JXTextareaAutosize as LibraryTextarea,
} from '@jacxishippingorg/jx-ui-react'

type Classed<T> = T & { className?: string }
const mergeClass = (base: string, extra?: string) => `${base}${extra ? ` ${extra}` : ''}`

export function JXButton(props: ComponentProps<typeof LibraryButton>) {
  const { className, lockWidth, variant = 'contained', color = 'primary', ...rest } = props
  return <LibraryButton {...rest} variant={variant} color={color} lockWidth={lockWidth ?? false} spring={false} halo={false} className={mergeClass(`jx-app-button jx-app-button--${variant} jx-app-button--${color}`, className)} />
}

export function JXButtonGroup(props: ComponentProps<typeof LibraryButtonGroup>) {
  const { className, ...rest } = props
  return <LibraryButtonGroup {...rest} className={mergeClass('jx-app-button-group', className)} />
}

export function JXCard(props: ComponentProps<typeof LibraryCard>) {
  const { className, ...rest } = props
  return <LibraryCard {...rest} spotlight={false} hoverLift={false} className={mergeClass('jx-app-card', className)} />
}

export function JXAlert(props: ComponentProps<typeof LibraryAlert>) {
  const { className, actionLabel, technicalDetails, ...rest } = props
  return <LibraryAlert {...rest} actionLabel={actionLabel ?? ''} technicalDetails={technicalDetails ?? ''} className={mergeClass('jx-app-alert', className)} />
}

export function JXChip(props: ComponentProps<typeof LibraryChip>) {
  const { className, ...rest } = props
  return <LibraryChip {...rest} className={mergeClass('jx-app-chip', className)} />
}

export function JXSelect(props: ComponentProps<typeof LibrarySelect>) {
  const { className, ...rest } = props
  return <LibrarySelect {...rest} className={mergeClass('jx-app-select', className)} />
}

export function JXTextField(props: ComponentProps<typeof LibraryTextField>) {
  const { className, ...rest } = props
  return <LibraryTextField {...rest} clearable={false} showCharacterCounter={false} showEntropyMeter={false} className={mergeClass('jx-app-text-field', className)} />
}

export function JXSwitch(props: ComponentProps<typeof LibrarySwitch>) {
  const { className, ...rest } = props
  return <LibrarySwitch {...rest} trackIcons={false} className={mergeClass('jx-app-switch', className)} />
}

export function JXAvatar(props: ComponentProps<typeof LibraryAvatar>) {
  const { className, ...rest } = props
  return <LibraryAvatar {...rest} className={mergeClass('jx-app-avatar', className)} />
}

export function JXAvatarGroup(props: ComponentProps<typeof LibraryAvatarGroup>) {
  const { className, interactiveFanOut = false, ...rest } = props
  return <LibraryAvatarGroup {...rest} interactiveFanOut={interactiveFanOut} className={mergeClass('jx-app-avatar-group', className)} />
}

export function JXTimeline(props: ComponentProps<typeof LibraryTimeline>) {
  const { className, ...rest } = props
  return <LibraryTimeline {...rest} className={mergeClass('jx-app-timeline', className)} />
}

export function JXProgress(props: ComponentProps<typeof LibraryProgress>) {
  const { className, ...rest } = props
  return <LibraryProgress {...rest} className={mergeClass('jx-app-progress', className)} />
}

export function JXStepper(props: ComponentProps<typeof LibraryStepper>) {
  const { className, ...rest } = props
  return <LibraryStepper {...rest} className={mergeClass('jx-app-stepper', className)} />
}

export function JXNumberField(props: ComponentProps<typeof LibraryNumberField>) {
  const { className, ...rest } = props
  return <LibraryNumberField {...rest} className={mergeClass('jx-app-number-field', className)} />
}

export function JXTextareaAutosize(props: ComponentProps<typeof LibraryTextarea>) {
  const { className, ...rest } = props
  return <LibraryTextarea {...rest} className={mergeClass('jx-app-textarea', className)} />
}

export type JXButtonProps = Classed<ComponentProps<typeof LibraryButton>>
