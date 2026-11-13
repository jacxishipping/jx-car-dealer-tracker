import { useId, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

import { JXButton, JXCard, JXStepper } from './JXUI'
import { Alert, PageHeader } from './ui'

export type WorkflowStep = { id: string; label: string; description: string }

export function WorkflowPage({
  title, subtitle, steps, step, onStepChange, onCancel, onBack, onNext, onSubmit,
  submitLabel, error, children,
}: {
  title: string
  subtitle: string
  steps: WorkflowStep[]
  step: number
  onStepChange: (index: number) => void
  onCancel: () => void
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
  submitLabel: string
  error?: string | null
  children: ReactNode
}) {
  const errorId = useId()
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<JXButton variant="outlined" lockWidth={false} onClick={onCancel}>Cancel</JXButton>} />
      <div className="mx-auto max-w-4xl">
        <JXCard className="jx-vehicle-wizard-card">
          <div className="space-y-6 p-4 sm:p-6">
            <JXStepper className="jx-app-stepper--progress-only" steps={steps} activeStep={step} nonLinear={false} onStepChange={(target) => { if (target <= step) onStepChange(target) }} />
            {error && <div id={errorId} role="alert"><Alert severity="error" title="Review this step" description={error} /></div>}
            {children}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
              <JXButton variant="text" lockWidth={false} onClick={step === 0 ? onCancel : onBack}>{step === 0 ? 'Cancel' : 'Back'}</JXButton>
              <JXButton variant="contained" lockWidth={false} onClick={step === steps.length - 1 ? onSubmit : onNext} className="w-full sm:w-auto">
                {step === steps.length - 1 ? submitLabel : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
              </JXButton>
            </div>
          </div>
        </JXCard>
      </div>
    </>
  )
}
