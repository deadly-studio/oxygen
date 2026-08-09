import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api.js'

export interface LoginPageProps {
  onLoggedIn: () => void
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function requestCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.requestOtp(email)
      setInfo(res.message)
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.verifyOtp(email, code)
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>oxygen admin</h1>
        {step === 'email' ? (
          <form onSubmit={requestCode}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={busy}>
              Send code
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            {info && <p className="field-hint">{info}</p>}
            <label htmlFor="code">Code</label>
            <input id="code" type="text" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="submit" disabled={busy}>
              Verify
            </button>
            <button type="button" onClick={() => setStep('email')}>
              Back
            </button>
          </form>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>
    </div>
  )
}
