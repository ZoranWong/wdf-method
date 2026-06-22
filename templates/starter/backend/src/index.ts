// Backend entrypoint — starter template.
//
// This is a minimal Express server. Phase 4 stories will replace the
// route registrations with real handlers as they are implemented.

import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`backend listening on :${PORT}`);
  });
}

export default app;
