#!/usr/bin/env node
import { runServer } from "./server.js";

runServer().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
