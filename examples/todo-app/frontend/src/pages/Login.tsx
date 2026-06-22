// src/pages/Login.tsx
// Story: S-AUTH-04 (frontend)
// Maps to REQ: REQ-002
//
// Top-level Login page. Renders the LoginForm and, on a successful
// response, persists the session via AuthContext.login() then
// navigates to /todos.

import { useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/auth/LoginForm';
import { useAuth } from '../contexts/AuthContext';
import type { User } from '../api/auth';

export default function Login() {
  const navigate = useNavigate();
  const auth = useAuth();

  function handleLogin(user: User, accessToken: string) {
    auth.login(user, accessToken);
    navigate('/todos');
  }

  return (
    <main className="page" aria-labelledby="login-title">
      <h1 id="login-title" className="page__title">
        Sign in
      </h1>
      <LoginForm onLogin={handleLogin} />
      <p className="form__hint">
        Don't have an account? <a href="/register">Create one</a>
      </p>
    </main>
  );
}
