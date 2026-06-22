// src/app.ts
// Story: S-AUTH-01, S-TODO-01
// Maps to REQ: REQ-001, REQ-004, REQ-007
//
// Composes the Express application. Kept separate from the server
// bootstrap (src/index.ts is reserved for S-AUTH-03+ when the actual
// listen() entry point lands) so `supertest` can import the app without
// binding a port.

import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { todosRouter } from "./routes/todos.js";

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Health probe — used by container orchestrators; not in the OpenAPI
  // surface but harmless to ship.
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Mount the auth router under the API version prefix mandated by the spec.
  app.use("/api/v1/auth", authRouter);

  // S-TODO-01: Todo CRUD router. All sub-routes are guarded by requireAuth.
  app.use("/api/v1/todos", todosRouter);

  // Centralized error handler — keep AFTER all routes. Express detects
  // 4-arg middleware specially.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // Don't leak stack traces. Log to stderr in non-test so test output
    // stays clean; production platforms capture stderr.
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.error("[app error]", err);
    }
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });

  return app;
}
