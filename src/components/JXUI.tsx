import type { ComponentProps, ReactNode } from 'react'
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

/** Library defaults maxLength to 64; omitters need a high practical cap. */
const DEFAULT_TEXT_MAX = 10_000

export function JXButton(props: ComponentProps<typeof LibraryButton>) {
  // Library JXButton hardcodes type="button", so type="submit" never reaches the DOM.
  // When callers ask for submit, requestSubmit on click so forms still work.
  const { className, lockWidth, variant = 'contained', color = 'primary', size = 'md', type = 'button', onClick, loadingLabel, ...rest } = props
  return (
    <LibraryButton
      {...rest}
      type={type}
      variant={variant}
      color={color}
      size={size}
      lockWidth={lockWidth ?? false}
      spring={false}
      halo={false}
      loadingLabel={loadingLabel ?? 'Please wait…'}
      className={mergeClass(`jx-app-button jx-app-button--${variant} jx-app-button--${color} jx-app-button--${size}`, className)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || type !== 'submit') return
        const target = event.currentTarget as HTMLButtonElement
        if (target.type === 'submit') return
        const form = target.closest('form')
        if (form) {
          event.preventDefault()
          form.requestSubmit()
        }
      }}
    />
  )
}

export function JXButtonGroup(props: ComponentProps<typeof LibraryButtonGroup>) {
  const { className, ...rest } = props
  return <LibraryButtonGroup {...rest} className={mergeClass('jx-app-button-group', className)} />
}

export function JXCard(props: ComponentProps<typeof LibraryCard>) {
  const { className, title, kicker, description, children, ...rest } = props
  // Library does `children || <header>`, so title/kicker/description are dropped
  // whenever children exist. Always compose the header ourselves.
  const body: ReactNode = (
    <>
      {(title || kicker || description) && (
        <div className="jx-app-card__header mb-3">
          {kicker && <p className="text-xs font-mono font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{kicker}</p>}
          {title && <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>}
          {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      )}
      {children}
    </>
  )
  return <LibraryCard {...rest} spotlight={false} hoverLift={false} className={mergeClass('jx-app-card', className)}>{body}</LibraryCard>
}

export function JXAlert(props: ComponentProps<typeof LibraryAlert>) {
  const { className, actionLabel, technicalDetails, description, ...rest } = props
  return (
    <LibraryAlert
      {...rest}
      description={description ?? ''}
      actionLabel={actionLabel ?? ''}
      technicalDetails={technicalDetails ?? ''}
      className={mergeClass('jx-app-alert', className)}
    />
  )
}

export function JXChip(props: ComponentProps<typeof LibraryChip>) {
  const { className, tone = 'neutral', ...rest } = props
  return <LibraryChip {...rest} tone={tone} className={mergeClass(`jx-app-chip jx-app-chip--${tone}`, className)} />
}

export function JXSelect(props: ComponentProps<typeof LibrarySelect>) {
  const { className, ...rest } = props
  return <LibrarySelect {...rest} className={mergeClass('jx-app-select', className)} />
}

export function JXTextField(props: ComponentProps<typeof LibraryTextField>) {
  const { className, maxLength, ...rest } = props
  return (
    <LibraryTextField
      {...rest}
      maxLength={maxLength ?? DEFAULT_TEXT_MAX}
      clearable={false}
      showCharacterCounter={false}
      showEntropyMeter={false}
      className={mergeClass('jx-app-text-field', className)}
    />
  )
}

export function JXSwitch(props: ComponentProps<typeof LibrarySwitch>) {
  const { className, cardMode, ...rest } = props
  return <LibrarySwitch {...rest} cardMode={cardMode ?? false} trackIcons={false} className={mergeClass('jx-app-switch', className)} />
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
  const { className, showControls = false, eta = '', completeLabel = 'Complete', ...rest } = props
  return <LibraryProgress {...rest} showControls={showControls} eta={eta} completeLabel={completeLabel} className={mergeClass('jx-app-progress', className)} />
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
  const { className, showToolbar, maxLength, ...rest } = props
  return (
    <LibraryTextarea
      {...rest}
      showToolbar={showToolbar ?? false}
      maxLength={maxLength ?? DEFAULT_TEXT_MAX}
      className={mergeClass('jx-app-textarea', className)}
    />
  )
}

export type JXButtonProps = Classed<ComponentProps<typeof LibraryButton>>
