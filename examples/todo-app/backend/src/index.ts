// src/index.ts
// Server bootstrap — starts the Express app on the configured port.
//
// This file is separate from app.ts so that tests can import the Express
// app without binding a port (via supertest).

import { createApp } from './app.js';
import { env } from './config/env.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function main() {
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`🚀 Todo API listening on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV ?? 'development'}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
