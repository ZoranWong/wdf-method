// src/schemas/todos.ts
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004, REQ-005
//
// Client-side zod schemas for the todo CRUD form. The wire contract
// (backend /api/v1/todos) accepts {title, description?, due_date?, priority?}.
// Field rules mirror backend validation:
//   - title: 1..200 chars
//   - description: 0..2000 chars (optional)
//   - due_date: valid ISO date string (optional)
//   - priority: 'low' | 'medium' | 'high' (optional, defaults to 'medium')

import { z } from 'zod'

export const createTodoSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required.')
    .max(200, 'Title must be 200 characters or fewer.'),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or fewer.')
    .optional()
    .or(z.literal('')),
  due_date: z
    .string()
    .optional()
    .or(z.literal('')),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

export type CreateTodoFormValues = z.infer<typeof createTodoSchema>
