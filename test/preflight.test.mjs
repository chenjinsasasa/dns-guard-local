import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { buildManagedDns, collectDnsEndpoints } from '../core.mjs';

const execFileAsync = promisify(execFile);
const CLASH_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'io.github.clash-verge-rev.clash-verge-rev',
);
const RUNTIME_PATH = path.join(CLASH_DIR, 'clash-verge.yaml');
const MIHOMO_BIN = '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

test('builds and validates an encrypted candidate without changing live config', async (context) => {
  if (process.platform !== 'darwin' || !(await exists(RUNTIME_PATH)) || !(await exists(MIHOMO_BIN))) {
    context.skip('requires the local macOS Clash Verge runtime');
    return;
  }

  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-guard-preflight-'));
  const candidate = path.join(temporaryDir, 'candidate.yaml');
  const dnsFile = path.join(temporaryDir, 'managed-dns.json');
  try {
    const { stdout } = await execFileAsync(
      'yq',
      ['-o=json', '.dns', RUNTIME_PATH],
      { encoding: 'utf8', timeout: 10_000 },
    );
    const currentDns = JSON.parse(stdout);
    const managedDns = buildManagedDns(currentDns);
    const endpoints = collectDnsEndpoints(managedDns);
    assert.equal(endpoints.some((item) => item.transport === 'plaintext'), false);
    assert.equal(endpoints.some((item) => item.transport === 'system'), false);
    assert.equal(managedDns['respect-rules'], true);

    await fs.copyFile(RUNTIME_PATH, candidate);
    await fs.writeFile(dnsFile, JSON.stringify(managedDns), { mode: 0o600 });
    await execFileAsync(
      'yq',
      ['-i', '. = (. // {}) | .dns = load(strenv(DNS_GUARD_DNS_FILE))', candidate],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, DNS_GUARD_DNS_FILE: dnsFile },
      },
    );
    await execFileAsync(
      MIHOMO_BIN,
      ['-t', '-d', CLASH_DIR, '-f', candidate],
      { encoding: 'utf8', timeout: 25_000, maxBuffer: 8 * 1024 * 1024 },
    );
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
});
