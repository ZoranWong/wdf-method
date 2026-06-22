// src/components/auth/LoginForm.tsx
// Story: S-AUTH-04 (frontend)
// Maps to REQ: REQ-002
//
// Controlled login form. Client-side validation via zod (loginFormSchema)
// runs before the network call. On submit we call the provided `onLogin`
// callback with the parsed {user, access_token} from the login response.
// A 401 response surfaces a generic "Invalid email or password" message
// (AC2) — we never reveal which field is wrong.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { loginFormSchema } from '../../schemas/auth';
import { loginUser, ApiError, type User } from '../../api/auth';

export interface LoginFormProps {
  /** Called with the user + JWT after a successful login. */
  onLogin: (user: User, accessToken: string) => void;
}

type FieldName = 'email' | 'password';

interface FormState {
  email: string;
  password: string;
}

const EMPTY: FormState = { email: '', password: '' };

export function LoginForm({ onLogin }: LoginFormProps) {
  const [values, setValues] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function updateField(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    // AC1: client-side validation before the fetch.
    const parsed = loginFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          (key === 'email' || key === 'password') &&
          !fieldErrors[key]
        ) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await loginUser({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      onLogin(res.user, res.access_token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // AC2: generic message — never reveal which field is wrong.
        setFormError('Invalid email or password.');
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Network error. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (f: FieldName) => errors[f];
  const submitDisabled = submitting;

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Login form">
      <div className="form-field">
        <label className="form-field__label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
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
            fieldError('email') ? 'login-email-error' : undefined
          }
        />
        {fieldError('email') && (
          <span
            id="login-email-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('email')}
          </span>
        )}
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          className={
            'form-field__input' +
            (fieldError('password') ? ' form-field__input--error' : '')
          }
          value={values.password}
          onChange={(e) => updateField('password', e.target.value)}
          aria-invalid={Boolean(fieldError('password'))}
          aria-describedby={
            fieldError('password') ? 'login-password-error' : undefined
          }
        />
        {fieldError('password') && (
          <span
            id="login-password-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('password')}
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
        data-testid="login-submit"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
