#!/usr/bin/env node
import { startServer } from '../src/server.js';

startServer().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
