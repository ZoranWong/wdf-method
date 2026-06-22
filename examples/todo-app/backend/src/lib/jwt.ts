// src/lib/jwt.ts
// Story: S-TODO-01 (deprecated stub — DO NOT IMPORT)
//
// S-AUTH-01 has shipped src/services/auth.service.ts as the canonical
// JWT helper module. This file was a placeholder stub used while
// S-AUTH-01 was still in flight. It is intentionally kept as a thin
// re-export so any stray import (e.g. a stale editor cache) keeps
// working, and so reviewers see an explicit pointer to the canonical
// module. New code MUST import from services/auth.service.ts directly.

export {
  verifyAccessToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../services/auth.service.js";
