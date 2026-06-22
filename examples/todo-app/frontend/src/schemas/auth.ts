// src/schemas/auth.ts
// Story: S-AUTH-02 (frontend)
// Maps to REQ: REQ-001
//
// Client-side form schema for the register form. The wire body sent to
// the backend drops `confirmPassword` (the S-AUTH-01 register endpoint
// only accepts {name, email, password}); we keep it in the schema for
// UX so we can produce a clean mismatch error before round-tripping.
//
// Field rules mirror backend/src/schemas/auth.ts registerSchema:
//   - name: 1..120 chars
//   - email: valid email
//   - password: >= 8 chars

import { z } from 'zod'

export const registerFormSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required.')
      .max(120, 'Name must be 120 characters or fewer.'),
    email: z
      .string()
      .min(1, 'Email is required.')
      .email('Enter a valid email address.'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

export type RegisterFormValues = z.infer<typeof registerFormSchema>

// ---------------------------------------------------------------------------
// Login form schema (S-AUTH-04)
// ---------------------------------------------------------------------------

export const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.'),
})

export type LoginFormValues = z.infer<typeof loginFormSchema>

/**
 * Strip confirmPassword before sending to the backend.
 * The wire contract (S-AUTH-01) is {name, email, password}.
 */
export function toRegisterInput(values: RegisterFormValues): {
  name: string
  email: string
  password: string
} {
  return {
    name: values.name,
    email: values.email,
    password: values.password,
  }
}
