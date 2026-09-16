#!/usr/bin/env node
import { startServer } from '../src/server.js';
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
  console.log(`local-context-mcp\n\nCommands:\n  start                 Start the local MCP server\n  setup                 Create/configure the named Cloudflare Tunnel\n  tunnel                Run the configured Cloudflare Tunnel\n  doctor                Check local prerequisites\n\nSetup options:\n  --hostname <host>     Public hostname (default: ${DEFAULT_HOSTNAME})\n  --tunnel-name <name>  Cloudflare Tunnel name (default: ${DEFAULT_TUNNEL_NAME})\n\nExamples:\n  local-context-mcp setup\n  local-context-mcp start\n  local-context-mcp tunnel\n`);
}

async function main() {
  const command = process.argv[2] || 'start';

  if (command === 'start') {
    await startServer();
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
    console.log(`Using Cloudflare hostname: ${hostname}`);
    console.log('If this machine has not been authorized with Cloudflare yet, run:');
    console.log('  cloudflared tunnel login');
    console.log('Then run this setup command again.\n');

    const result = setupNamedTunnel({ name, hostname });
    console.log(JSON.stringify(result, null, 2));
    console.log('\nTunnel configuration is ready.');
    console.log('Start the MCP server in one terminal:  npm start');
    console.log('Start the tunnel in another terminal: npm run tunnel');
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
