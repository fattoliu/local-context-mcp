#!/usr/bin/env node
import { startServer } from '../src/server.js';
import { createPairingCode } from '../src/pairing.js';
import {
  DEFAULT_HOSTNAME,
  DEFAULT_TUNNEL_NAME,
  cloudflaredVersion,
  hasCloudflared,
  runNamedTunnel,
  setupNamedTunnel,
} from '../src/tunnel.js';

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function help() {
  console.log(`local-context-mcp\n\nCommands:\n  start                 Start the local MCP server\n  pair                  Generate a one-time code for OAuth authorization\n  setup                 Configure a locally-managed Cloudflare Tunnel (legacy)\n  tunnel                Run the configured local tunnel\n  doctor                Check local prerequisites\n\nExamples:\n  local-context-mcp start\n  local-context-mcp pair\n`);
}

async function main() {
  const command = process.argv[2] || 'start';

  if (command === 'start') {
    await startServer();
    return;
  }

  if (command === 'pair') {
    const result = createPairingCode();
    console.log(`Pairing code: ${result.code}`);
    console.log(`Expires at:   ${result.expiresAt}`);
    console.log('Enter this code only on the local-context-mcp authorization page opened by ChatGPT.');
    return;
  }

  if (command === 'doctor') {
    const installed = hasCloudflared();
    console.log(JSON.stringify({
      node: process.version,
      cloudflared: installed ? cloudflaredVersion() : null,
      cloudflaredInstalled: installed,
      expectedHostname: DEFAULT_HOSTNAME,
    }, null, 2));
    return;
  }

  if (command === 'setup') {
    if (!hasCloudflared()) {
      console.error('cloudflared is required. On macOS run: brew install cloudflared');
      process.exitCode = 1;
      return;
    }
    const hostname = readOption('--hostname', DEFAULT_HOSTNAME);
    const name = readOption('--tunnel-name', DEFAULT_TUNNEL_NAME);
    const result = setupNamedTunnel({ name, hostname });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'tunnel') {
    runNamedTunnel();
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
