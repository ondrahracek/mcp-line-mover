#!/usr/bin/env node
import { runServer } from "./server.js";

const exitOnEpipe = (err: NodeJS.ErrnoException): void => {
  if (err.code === "EPIPE") process.exit(0);
};
process.stdout.on("error", exitOnEpipe);
process.stderr.on("error", exitOnEpipe);

runServer().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
