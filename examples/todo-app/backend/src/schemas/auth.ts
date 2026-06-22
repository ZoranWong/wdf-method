// src/schemas/auth.ts
// Story: S-AUTH-01
// Maps to REQ: REQ-001
//
// Zod schemas mirroring `_wdf_output/api-spec.yaml`:
//   RegisterInput  { name: string>=1, email: email, password: string>=8 }
// The OpenAPI spec caps `name.maxLength` at 120 — we enforce it here so
// the DB column (text, unbounded) is protected from runaway input.

import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// Login uses a 1-char password floor (NOT 8). The OpenAPI LoginInput
// schema only requires the field be present and non-empty — otherwise
// we'd leak user existence: a malformed body would 400 only when the
// user actually exists. Treat any non-empty string as "candidate
// credential" and let the constant-time 401 path handle the rest.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
