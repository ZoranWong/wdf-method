// src/App.tsx
// Stories: S-AUTH-02 (initial router), S-AUTH-04 (login + auth + protected),
//          S-TODO-04 (todos page)
//
// The root router. AuthProvider wraps the entire tree so every route
// can access auth state. Public routes: /register, /login. Protected
// routes (wrapped in ProtectedRoute): /todos.
// Root / redirects to /login for now.

import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Register from './pages/Register'
import Login from './pages/Login'
import Todos from './pages/Todos'
import ProtectedRoute from './components/auth/ProtectedRoute'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />

        {/* Protected route — S-TODO-04 */}
        <Route
          path="/todos"
          element={
            <ProtectedRoute>
              <Todos />
            </ProtectedRoute>
          }
        />

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  )
}
