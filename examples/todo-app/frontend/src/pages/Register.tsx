// src/pages/Register.tsx
// Stories: S-AUTH-02 (original), S-AUTH-04 (AuthContext integration)
// Maps to REQ: REQ-001
//
// Top-level Register page. Renders the RegisterForm and, on a
// successful 201 response, persists the session via
// AuthContext.login() so ProtectedRoute lets the user through to
// /todos — then navigates there.

import { useNavigate } from 'react-router-dom'
import { RegisterForm } from '../components/auth/RegisterForm'
import { useAuth } from '../contexts/AuthContext'
import type { User } from '../api/auth'

export default function Register() {
  const navigate = useNavigate()
  const auth = useAuth()

  function handleRegistered(user: User, accessToken: string) {
    // After a successful register the server has already set httpOnly
    // cookies and returned the user + JWT. Persist them so the
    // ProtectedRoute on /todos sees an authenticated user.
    auth.login(user, accessToken)
    navigate('/todos')
  }

  return (
    <main className="page" aria-labelledby="register-title">
      <h1 id="register-title" className="page__title">
        Create your account
      </h1>
      <RegisterForm onRegistered={handleRegistered} />
      <p className="form__hint">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </main>
  )
}
