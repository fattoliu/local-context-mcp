import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_TUNNEL_NAME = 'local-context-mcp';
export const DEFAULT_HOSTNAME = 'mcp.fatto.dpdns.org';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

export function hasCloudflared() {
  const result = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

export function cloudflaredVersion() {
  if (!hasCloudflared()) return null;
  return run('cloudflared', ['--version']);
}

function listTunnels() {
  const raw = run('cloudflared', ['tunnel', 'list', '--output', 'json']);
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function findTunnel(name) {
  return listTunnels().find((item) => item.name === name) || null;
}

function createTunnel(name) {
  run('cloudflared', ['tunnel', 'create', name], { inherit: true });
  const tunnel = findTunnel(name);
  if (!tunnel) throw new Error(`Tunnel '${name}' was created but could not be found.`);
  return tunnel;
}

function routeDns(name, hostname) {
  const result = spawnSync('cloudflared', ['tunnel', 'route', 'dns', name, hostname], {
    encoding: 'utf8',
  });
  if (!result.error && result.status === 0) return;

  const detail = [result.stderr, result.stdout].filter(Boolean).join('\n');
  // cloudflared reports an error when the DNS route already exists. Treat that
  // as idempotent; other failures still surface.
  if (/already exists|already configured|code: 1003/i.test(detail)) return;
  throw new Error(`Failed to route ${hostname} to tunnel '${name}': ${detail.trim()}`);
}

function findCredentialsFile(tunnelId) {
  const candidate = path.join(os.homedir(), '.cloudflared', `${tunnelId}.json`);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Tunnel credentials not found at ${candidate}. Run cloudflared tunnel login and setup again.`);
  }
  return candidate;
}

export function tunnelStateDir() {
  return path.join(os.homedir(), '.local-context-mcp');
}

export function tunnelConfigPath() {
  return path.join(tunnelStateDir(), 'cloudflared.yml');
}

function writeTunnelConfig({ tunnelId, hostname, service }) {
  const dir = tunnelStateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const credentialsFile = findCredentialsFile(tunnelId);
  const yaml = [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${credentialsFile}`,
    'ingress:',
    `  - hostname: ${hostname}`,
    `    service: ${service}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
  fs.writeFileSync(tunnelConfigPath(), yaml, { mode: 0o600 });
  return { configPath: tunnelConfigPath(), credentialsFile };
}

export function setupNamedTunnel({
  name = DEFAULT_TUNNEL_NAME,
  hostname = DEFAULT_HOSTNAME,
  service = 'http://127.0.0.1:7331',
} = {}) {
  if (!hasCloudflared()) {
    throw new Error('cloudflared is not installed. On macOS run: brew install cloudflared');
  }

  let tunnel;
  try {
    tunnel = findTunnel(name);
  } catch (error) {
    throw new Error(`Cloudflare is not authenticated yet. Run: cloudflared tunnel login\n${error instanceof Error ? error.message : error}`);
  }

  if (!tunnel) tunnel = createTunnel(name);
  routeDns(name, hostname);
  const files = writeTunnelConfig({ tunnelId: tunnel.id, hostname, service });

  return {
    name,
    id: tunnel.id,
    hostname,
    publicUrl: `https://${hostname}/mcp`,
    service,
    ...files,
  };
}

export function runNamedTunnel() {
  const config = tunnelConfigPath();
  if (!fs.existsSync(config)) {
    throw new Error(`Tunnel config does not exist: ${config}. Run 'local-context-mcp setup' first.`);
  }
  const result = spawnSync('cloudflared', ['tunnel', '--config', config, 'run'], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cloudflared exited with status ${result.status}`);
}
