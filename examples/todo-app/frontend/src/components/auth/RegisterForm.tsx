// src/components/auth/RegisterForm.tsx
// Story: S-AUTH-02 (frontend)
// Maps to REQ: REQ-001
//
// Controlled register form. Validation runs client-side via zod
// (registerFormSchema) so AC6 (password mismatch) is caught before any
// network call. On submit we POST to /api/v1/auth/register with
// credentials:'include' (AC2) so the backend can set the httpOnly
// access_token + refresh_token cookies. We deliberately strip
// `confirmPassword` from the wire body.

import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  registerFormSchema,
  toRegisterInput,
} from '../../schemas/auth'
import {
  registerUser,
  ApiError,
  type User,
  type FieldError,
} from '../../api/auth'

export interface RegisterFormProps {
  /** Called after the server returns 201 with the created user + JWT. */
  onRegistered: (user: User, accessToken: string) => void
}

type FieldName = 'name' | 'email' | 'password' | 'confirmPassword'

interface FormState {
  name: string
  email: string
  password: string
  confirmPassword: string
}

const EMPTY: FormState = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
}

function pathToField(path: PropertyKey[]): FieldName | null {
  const key = path[0]
  if (
    key === 'name' ||
    key === 'email' ||
    key === 'password' ||
    key === 'confirmPassword'
  ) {
    return key
  }
  return null
}

/**
 * Merge server-issued field errors (zod issue shape, see
 * ApiError.fieldErrors) onto the per-field error map. Last write wins,
 * which is fine because the server only sends one issue per path.
 */
function mergeServerErrors(
  server: FieldError[],
): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {}
  for (const fe of server) {
    const field = pathToField(fe.path)
    if (field) out[field] = fe.message
  }
  return out
}

export function RegisterForm({ onRegistered }: RegisterFormProps) {
  const [values, setValues] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function updateField(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    // Clear stale error when the user starts correcting a field.
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return

    // AC6: client-side validation runs before the fetch.
    const parsed = registerFormSchema.safeParse(values)
    if (!parsed.success) {
      const fieldErrors: Partial<Record<FieldName, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = pathToField(issue.path)
        if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      const res = await registerUser(toRegisterInput(parsed.data))
      onRegistered(res.user, res.access_token)
    } catch (err) {
      if (err instanceof ApiError) {
        // AC4: 409 → "email already registered" inline error.
        if (err.status === 409 && err.code === 'EMAIL_TAKEN') {
          setErrors((prev) => ({
            ...prev,
            email: 'Email already registered.',
          }))
          setFormError('An account with this email already exists.')
        } else if (
          err.status === 400 &&
          err.code === 'INVALID_INPUT' &&
          err.fieldErrors.length > 0
        ) {
          // AC5: 400 → field-level errors next to relevant inputs.
          setErrors(mergeServerErrors(err.fieldErrors))
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError('Network error. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const fieldError = (f: FieldName) => errors[f]

  // AC7: source order in JSX matches the requested tab order
  // (name → email → password → confirm → submit). The submit button is
  // disabled while a request is in flight (AC8). Validation runs on
  // submit click (see handleSubmit), which is how AC6 surfaces the
  // mismatch / format errors before any network call.
  const submitDisabled = submitting

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Register form">
      <div className="form-field">
        <label className="form-field__label" htmlFor="register-name">
          Name
        </label>
        <input
          id="register-name"
          name="name"
          type="text"
          autoComplete="name"
          className={
            'form-field__input' +
            (fieldError('name') ? ' form-field__input--error' : '')
          }
          value={values.name}
          onChange={(e) => updateField('name', e.target.value)}
          aria-invalid={Boolean(fieldError('name'))}
          aria-describedby={
            fieldError('name') ? 'register-name-error' : undefined
          }
        />
        {fieldError('name') && (
          <span
            id="register-name-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('name')}
          </span>
        )}
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="register-email">
          Email
        </label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          className={
            'form-field__input' +
            (fieldError('email') ? ' form-field__input--error' : '')
          }
          value={values.email}
          onChange={(e) => updateField('email', e.target.value)}
          aria-invalid={Boolean(fieldError('email'))}
          aria-describedby={
            fieldError('email') ? 'register-email-error' : undefined
          }
        />
        {fieldError('email') && (
          <span
            id="register-email-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('email')}
          </span>
        )}
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="register-password">
          Password
        </label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={
            'form-field__input' +
            (fieldError('password') ? ' form-field__input--error' : '')
          }
          value={values.password}
          onChange={(e) => updateField('password', e.target.value)}
          aria-invalid={Boolean(fieldError('password'))}
          aria-describedby={
            fieldError('password') ? 'register-password-error' : undefined
          }
        />
        {fieldError('password') && (
          <span
            id="register-password-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('password')}
          </span>
        )}
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="register-confirm">
          Confirm password
        </label>
        <input
          id="register-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          className={
            'form-field__input' +
            (fieldError('confirmPassword')
              ? ' form-field__input--error'
              : '')
          }
          value={values.confirmPassword}
          onChange={(e) => updateField('confirmPassword', e.target.value)}
          aria-invalid={Boolean(fieldError('confirmPassword'))}
          aria-describedby={
            fieldError('confirmPassword')
              ? 'register-confirm-error'
              : undefined
          }
        />
        {fieldError('confirmPassword') && (
          <span
            id="register-confirm-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('confirmPassword')}
          </span>
        )}
      </div>

      {formError && (
        <div className="form-field__error" role="alert" data-testid="form-error">
          {formError}
        </div>
      )}

      <button
        type="submit"
        className="form__submit"
        disabled={submitDisabled}
        aria-busy={submitting}
        data-testid="register-submit"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
