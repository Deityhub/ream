import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button, Icon } from '@ream/ui'

type Props = {
  name: string
  /** other locked files waiting after this one */
  others?: number
  /** try the password; resolves to an error message, or null when it worked */
  onSubmit: (password: string) => Promise<string | null>
  onSkip: () => void
}

/** Modal asking for a PDF's password. The password lives only in this component's state and is gone when it closes. */
export function PasswordDialog({ name, others = 0, onSubmit, onSkip }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const errorId = useId()

  useEffect(() => {
    const d = dialog.current!
    if (!d.open) d.showModal()
    return () => {
      if (d.open) d.close()
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const failure = await onSubmit(password)
    if (failure) {
      setError(failure)
      setBusy(false)
      input.current?.select()
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault() // Escape counts as "Skip", so the file never lingers locked
        onSkip()
      }}
      className="m-auto w-[min(28rem,92vw)] border border-line bg-canvas p-6 text-ink shadow-lg backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="space-y-4">
        <h2 id={titleId} className="text-2xl">
          Password needed
        </h2>
        <p className="text-sm">
          <span className="font-medium break-all">{name}</span> is password protected. Enter its password to use it.
        </p>
        <div className="flex gap-2">
          <input
            ref={input}
            autoFocus
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            aria-label="Password"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="min-w-0 flex-1 rounded-lg border border-field bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="button"
            aria-pressed={show}
            aria-label={show ? 'Hide password' : 'Show password'}
            onClick={() => setShow((s) => !s)}
            className="rounded-lg border border-field px-3 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon name={show ? 'eye-off' : 'eye'} className="size-4" />
          </button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        {others > 0 && (
          <p className="text-xs text-muted">
            {others} more locked {others === 1 ? 'file' : 'files'} after this one.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onSkip}>
            Skip this file
          </Button>
          <Button type="submit">{busy ? 'Unlocking…' : 'Unlock'}</Button>
        </div>
      </form>
    </dialog>
  )
}
