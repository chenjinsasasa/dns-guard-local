import http from 'node:http';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  assessSnapshot,
  buildManagedDns,
  clone,
  detectNetworkClients,
  detectGeoDnsLeak,
  parseDefaultRoute,
  parseRouteInterface,
  parseSystemDns,
  resolveDnsTestVerdict,
  sameValue,
} from './core.mjs';

const execFileAsync = promisify(execFile);
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DNS_GUARD_DATA_DIR
  ? path.resolve(process.env.DNS_GUARD_DATA_DIR)
  : path.join(APP_DIR, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const CLASH_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'io.github.clash-verge-rev.clash-verge-rev',
);
const PROFILES_PATH = path.join(CLASH_DIR, 'profiles.yaml');
const RUNTIME_PATH = path.join(CLASH_DIR, 'clash-verge.yaml');
const PROFILES_DIR = path.join(CLASH_DIR, 'profiles');
const MIHOMO_BIN = '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo';
const DEFAULT_SOCKET = '/tmp/verge/verge-mihomo.sock';
const HOST = '127.0.0.1';
const PORT = Number(process.env.DNS_GUARD_PORT || 41731);
const ACCESS_TOKEN = process.env.DNS_GUARD_TOKEN || crypto.randomBytes(24).toString('hex');
const APP_VERSION = '1.3.0';

let latestDnsTest = null;
let operationInProgress = false;

const STATE_BACKUP_KEYS = [
  'backupMerge',
  'backupRuntime',
  'backupBeforeDisableMerge',
  'backupBeforeDisableRuntime',
];

async function run(command, args = [], options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 8_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  return String(result.stdout || '').trim();
}

async function tryRun(command, args = [], options = {}) {
  try {
    return await run(command, args, options);
  } catch {
    return '';
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function listInstalledApplications() {
  const directories = [
    '/Applications',
    path.join(os.homedir(), 'Applications'),
  ];
  const results = await Promise.all(directories.map(async (directory) => {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
        .map((entry) => path.join(directory, entry.name));
    } catch {
      return [];
    }
  }));
  return results.flat();
}

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('PATH_OUTSIDE_SCOPE', '配置路径超出允许范围');
  }
}

async function readYamlJson(file, expression = '.') {
  const output = await run('yq', ['-o=json', expression, file], { timeout: 10_000 });
  if (!output || output === 'null') return null;
  return JSON.parse(output);
}

async function getActiveProfile() {
  if (!(await pathExists(PROFILES_PATH))) {
    throw new AppError('CLASH_NOT_FOUND', '未找到 Clash Verge 配置');
  }

  const profiles = await readYamlJson(PROFILES_PATH);
  const active = profiles?.items?.find((item) => item.uid === profiles.current);
  if (!active) throw new AppError('PROFILE_NOT_FOUND', '未找到当前 Clash 配置');

  const mergeUid = active.option?.merge;
  const merge = profiles.items.find((item) => item.uid === mergeUid && item.type === 'merge');
  if (!merge?.file) {
    throw new AppError('MERGE_NOT_FOUND', '当前配置未关联 Merge 扩展');
  }

  const mergePath = path.join(PROFILES_DIR, path.basename(merge.file));
  assertInside(PROFILES_DIR, mergePath);
  return {
    profileUid: active.uid,
    profileType: active.type,
    mergeUid,
    mergePath,
  };
}

async function getControllerSocket() {
  const processLine = await tryRun('pgrep', ['-afil', 'verge-mihomo']);
  const fromArgs = processLine.match(/-ext-ctl-unix\s+([^\s]+)/)?.[1];
  if (fromArgs && await pathExists(fromArgs)) return fromArgs;
  return DEFAULT_SOCKET;
}

async function requestClash(method, apiPath, body) {
  const socketPath = await getControllerSocket();
  if (!(await pathExists(socketPath))) {
    throw new AppError('CLASH_OFFLINE', 'Clash 内核未运行');
  }

  const args = [
    '--silent',
    '--show-error',
    '--max-time',
    '8',
    '--unix-socket',
    socketPath,
    '-X',
    method,
    '-w',
    '\n%{http_code}',
  ];
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  }
  args.push(`http://localhost${apiPath}`);

  const output = await run('curl', args, { timeout: 10_000 });
  const parts = output.split('\n');
  const status = Number(parts.pop());
  const responseBody = parts.join('\n').trim();
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new AppError('CLASH_API_FAILED', `Clash 返回 ${status || '未知状态'}`);
  }
  if (!responseBody) return null;
  try {
    return JSON.parse(responseBody);
  } catch {
    return responseBody;
  }
}

async function getClashSnapshot() {
  const activeProfile = await getActiveProfile();
  if (!(await pathExists(RUNTIME_PATH))) {
    throw new AppError('RUNTIME_NOT_FOUND', '未找到 Clash 运行配置');
  }

  const runtime = await readYamlJson(
    RUNTIME_PATH,
    '{"dns": .dns, "tun": .tun, "mode": .mode, "ipv6": .ipv6}',
  ) || {};

  let version = null;
  let running = false;
  try {
    const response = await requestClash('GET', '/version');
    version = response?.version || null;
    running = true;
  } catch {
    running = false;
  }

  return {
    running,
    version,
    mode: runtime.mode || null,
    ipv6: runtime.ipv6 ?? false,
    dns: runtime.dns || {},
    tun: runtime.tun || {},
    activeProfile,
  };
}

async function getNetworkSnapshot() {
  const defaultRouteOutput = await tryRun('route', ['-n', 'get', 'default']);
  const defaultRoute = parseDefaultRoute(defaultRouteOutput);
  const dnsOutput = await tryRun('scutil', ['--dns']);
  const systemDns = parseSystemDns(dnsOutput);

  const dnsRoutes = await Promise.all(systemDns.map(async (server) => {
    const familyArgs = server.includes(':')
      ? ['-n', 'get', '-inet6', server]
      : ['-n', 'get', server];
    const output = await tryRun('route', familyArgs);
    return { server, interface: parseRouteInterface(output) };
  }));

  const localIp = defaultRoute.interface
    ? await tryRun('ipconfig', ['getifaddr', defaultRoute.interface])
    : '';
  const interfaceOutput = defaultRoute.interface
    ? await tryRun('ifconfig', [defaultRoute.interface])
    : '';
  const ipv6Address = [...interfaceOutput.matchAll(/^\s*inet6\s+([^\s%]+)(?:%\S+)?/gm)]
    .map((match) => match[1])
    .find((address) => !address.toLowerCase().startsWith('fe80:')) || null;

  return {
    defaultInterface: defaultRoute.interface,
    gateway: defaultRoute.gateway,
    localIp: localIp || null,
    ipv6Address,
    systemDns,
    dnsRoutes,
  };
}

async function getTailscaleSnapshot() {
  const binary = '/opt/homebrew/bin/tailscale';
  if (!(await pathExists(binary))) return { installed: false, running: false };
  const output = await tryRun(binary, ['status', '--json'], { timeout: 4_000 });
  if (!output) return { installed: true, running: false };
  try {
    const status = JSON.parse(output);
    return {
      installed: true,
      running: status.BackendState === 'Running',
      state: status.BackendState || null,
      exitNodeActive: Object.values(status.Peer || {}).some((peer) => peer.ExitNode && peer.Active),
    };
  } catch {
    return { installed: true, running: false };
  }
}

async function readState() {
  try {
    const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
    for (const key of STATE_BACKUP_KEYS) {
      if (!state[key] || await pathExists(state[key])) continue;
      const migrated = path.join(BACKUP_DIR, path.basename(state[key]));
      if (await pathExists(migrated)) state[key] = migrated;
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { phase: 'disabled', enabled: false };
    throw error;
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(DATA_DIR, 0o700);
  const temporary = `${STATE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, STATE_PATH);
  await fs.chmod(STATE_PATH, 0o600);
}

async function getMergeDns(mergePath) {
  if (!(await pathExists(mergePath))) return { present: false, value: undefined };
  const document = await readYamlJson(mergePath);
  const present = Boolean(document && Object.prototype.hasOwnProperty.call(document, 'dns'));
  return { present, value: present ? document.dns : undefined };
}

async function getProtectionSnapshot(clash) {
  const state = await readState();
  const active = clash.activeProfile;
  let mergeDns = { present: false, value: undefined };
  try {
    mergeDns = await getMergeDns(active.mergePath);
  } catch {
    // Status remains available even if a Merge file is temporarily unreadable.
  }

  const sameProfile = Boolean(
    state.profileUid
    && state.profileUid === active.profileUid
    && state.mergeUid === active.mergeUid,
  );
  const effective = Boolean(
    state.enabled
    && sameProfile
    && sameValue(clash.dns, state.managedDns)
    && sameValue(mergeDns.value, state.managedDns),
  );

  return {
    enabled: Boolean(state.enabled),
    effective,
    available: clash.running && Boolean(active.mergePath),
    busy: operationInProgress,
    phase: state.phase || (state.enabled ? 'enabled' : 'disabled'),
    changedAt: state.changedAt || null,
    profileMatches: sameProfile || !state.enabled,
  };
}

async function buildStatus() {
  const [network, tailscale, installedPaths, processOutput] = await Promise.all([
    getNetworkSnapshot(),
    getTailscaleSnapshot(),
    listInstalledApplications(),
    tryRun('ps', ['-axo', 'command='], { timeout: 4_000, maxBuffer: 8 * 1024 * 1024 }),
  ]);

  let clash;
  try {
    clash = await getClashSnapshot();
  } catch (error) {
    clash = {
      running: false,
      version: null,
      mode: null,
      ipv6: false,
      dns: {},
      tun: {},
      error: error.message,
      activeProfile: null,
    };
  }

  let protection = {
    enabled: false,
    effective: false,
    available: false,
    busy: operationInProgress,
    phase: 'disabled',
    changedAt: null,
    profileMatches: true,
  };
  if (clash.activeProfile) protection = await getProtectionSnapshot(clash);

  const client = detectNetworkClients({
    installedPaths,
    processOutput,
    clashRunning: clash.running,
  });
  const assessment = assessSnapshot({ network, clash, client });
  if (latestDnsTest) {
    const externalState = latestDnsTest.verdict === 'leak'
      ? 'fail'
      : latestDnsTest.verdict === 'safe' ? 'pass' : 'warn';
    assessment.checks.push({
      id: 'external-test',
      label: '外部检测',
      state: externalState,
      value: externalState === 'fail' ? '发现泄漏' : externalState === 'pass' ? '未发现' : '需检查',
      detail: latestDnsTest.source,
    });
    if (externalState === 'fail') {
      assessment.level = 'leak';
      assessment.title = '外部检测发现泄漏';
      assessment.message = latestDnsTest.leakReason === 'china-dns'
        ? '发现中国大陆 DNS 出口'
        : '外部解析路径存在风险';
    } else if (externalState === 'pass' && client.mode === 'monitor') {
      assessment.level = 'safe';
      assessment.title = '外部检测未发现泄漏';
      assessment.message = '当前解析出口未发现异常';
    }
  }
  return {
    app: { version: APP_VERSION, localOnly: true },
    generatedAt: new Date().toISOString(),
    network,
    client,
    clash: {
      running: clash.running,
      version: clash.version,
      mode: clash.mode,
      ipv6: clash.ipv6,
      tun: clash.tun,
      dns: clash.dns,
      error: clash.error || null,
    },
    tailscale,
    protection,
    assessment,
    dnsTest: latestDnsTest,
  };
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function backupFile(source, label) {
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(BACKUP_DIR, 0o700);
  const destination = path.join(BACKUP_DIR, `${timestampSlug()}-${label}.yaml`);
  await fs.copyFile(source, destination);
  await fs.chmod(destination, 0o600);
  return destination;
}

async function sha256File(target) {
  const content = await fs.readFile(target);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function createDnsCandidate(source, candidate, dnsPresent, dnsValue) {
  await fs.copyFile(source, candidate);
  if (!dnsPresent) {
    await run('yq', ['-i', 'del(.dns)', candidate], { timeout: 10_000 });
    return;
  }

  const dnsFile = `${candidate}.dns.json`;
  await fs.writeFile(dnsFile, JSON.stringify(dnsValue), { mode: 0o600 });
  try {
    await run(
      'yq',
      ['-i', '. = (. // {}) | .dns = load(strenv(DNS_GUARD_DNS_FILE))', candidate],
      { env: { DNS_GUARD_DNS_FILE: dnsFile }, timeout: 10_000 },
    );
  } finally {
    await fs.rm(dnsFile, { force: true });
  }
}

async function validateRuntime(candidate) {
  if (!(await pathExists(MIHOMO_BIN))) {
    throw new AppError('MIHOMO_NOT_FOUND', '未找到 Mihomo 内核');
  }
  await run(MIHOMO_BIN, ['-t', '-d', CLASH_DIR, '-f', candidate], {
    timeout: 25_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function reloadRuntime() {
  await requestClash('PUT', '/configs?force=true', {
    path: RUNTIME_PATH,
    payload: '',
  });
  await requestClash('POST', '/cache/dns/flush').catch(() => null);
  await requestClash('POST', '/cache/fakeip/flush').catch(() => null);
}

async function atomicRestore(backup, target) {
  const temporary = `${target}.dns-guard-restore-${crypto.randomBytes(4).toString('hex')}`;
  await fs.copyFile(backup, temporary);
  await fs.rename(temporary, target);
}

async function enableProtection() {
  const clash = await getClashSnapshot();
  if (!clash.running) throw new AppError('CLASH_OFFLINE', '请先启动 Clash Verge');

  const currentState = await readState();
  if (currentState.enabled) {
    if (currentState.profileUid === clash.activeProfile.profileUid) return;
    throw new AppError('PROFILE_CHANGED', '请先切回原配置并关闭防泄漏');
  }

  const { mergePath, mergeUid, profileUid } = clash.activeProfile;
  if (!(await pathExists(mergePath))) {
    throw new AppError('MERGE_NOT_FOUND', '未找到当前 Merge 配置');
  }

  const originalMergeDns = await getMergeDns(mergePath);
  const originalRuntimeDns = {
    present: true,
    value: clone(clash.dns),
  };
  const managedDns = buildManagedDns(clash.dns);
  const backupMerge = await backupFile(mergePath, 'merge-before-enable');
  const backupRuntime = await backupFile(RUNTIME_PATH, 'runtime-before-enable');
  const nonce = crypto.randomBytes(5).toString('hex');
  const mergeCandidate = `${mergePath}.dns-guard-${nonce}`;
  const runtimeCandidate = `${RUNTIME_PATH}.dns-guard-${nonce}`;

  const pendingState = {
    version: 1,
    phase: 'pending-enable',
    enabled: false,
    profileUid,
    mergeUid,
    mergePath,
    runtimePath: RUNTIME_PATH,
    backupMerge,
    backupRuntime,
    originalMergeDns,
    originalRuntimeDns,
    managedDns,
    changedAt: new Date().toISOString(),
  };

  await writeState(pendingState);
  let filesChanged = false;
  try {
    await createDnsCandidate(mergePath, mergeCandidate, true, managedDns);
    await createDnsCandidate(RUNTIME_PATH, runtimeCandidate, true, managedDns);
    await validateRuntime(runtimeCandidate);
    await fs.rename(mergeCandidate, mergePath);
    await fs.rename(runtimeCandidate, RUNTIME_PATH);
    filesChanged = true;
    const managedMergeHash = await sha256File(mergePath);
    const managedRuntimeHash = await sha256File(RUNTIME_PATH);
    await reloadRuntime();
    await writeState({
      ...pendingState,
      phase: 'enabled',
      enabled: true,
      managedMergeHash,
      managedRuntimeHash,
      changedAt: new Date().toISOString(),
      lastError: null,
    });
  } catch (error) {
    if (filesChanged) {
      await atomicRestore(backupMerge, mergePath).catch(() => null);
      await atomicRestore(backupRuntime, RUNTIME_PATH).catch(() => null);
      await reloadRuntime().catch(() => null);
    }
    await writeState({
      ...pendingState,
      phase: 'disabled',
      enabled: false,
      changedAt: new Date().toISOString(),
      lastError: error.message,
    });
    throw error;
  } finally {
    await fs.rm(mergeCandidate, { force: true });
    await fs.rm(runtimeCandidate, { force: true });
  }
}

async function disableProtection() {
  const state = await readState();
  if (!state.enabled) return;

  const clash = await getClashSnapshot();
  if (!clash.running) throw new AppError('CLASH_OFFLINE', '请先启动 Clash Verge');
  if (
    clash.activeProfile.profileUid !== state.profileUid
    || clash.activeProfile.mergeUid !== state.mergeUid
  ) {
    throw new AppError('PROFILE_CHANGED', '当前配置与开启时不同');
  }

  const currentMergeDns = await getMergeDns(state.mergePath);
  if (!sameValue(currentMergeDns.value, state.managedDns)) {
    throw new AppError('MERGE_CONFLICT', 'Merge DNS 已被其他操作修改');
  }
  if (!sameValue(clash.dns, state.managedDns)) {
    throw new AppError('RUNTIME_CONFLICT', '运行 DNS 已被其他操作修改');
  }

  const backupMerge = await backupFile(state.mergePath, 'merge-before-disable');
  const backupRuntime = await backupFile(RUNTIME_PATH, 'runtime-before-disable');
  const currentMergeHash = await sha256File(state.mergePath);
  const currentRuntimeHash = await sha256File(RUNTIME_PATH);
  const canRestoreExact = Boolean(
    state.managedMergeHash
    && state.managedRuntimeHash
    && currentMergeHash === state.managedMergeHash
    && currentRuntimeHash === state.managedRuntimeHash,
  );
  const nonce = crypto.randomBytes(5).toString('hex');
  const mergeCandidate = `${state.mergePath}.dns-guard-${nonce}`;
  const runtimeCandidate = `${RUNTIME_PATH}.dns-guard-${nonce}`;
  const pendingState = {
    ...state,
    phase: 'pending-disable',
    backupBeforeDisableMerge: backupMerge,
    backupBeforeDisableRuntime: backupRuntime,
    changedAt: new Date().toISOString(),
  };

  await writeState(pendingState);
  let filesChanged = false;
  try {
    if (canRestoreExact) {
      await fs.copyFile(state.backupMerge, mergeCandidate);
      await fs.copyFile(state.backupRuntime, runtimeCandidate);
    } else {
      await createDnsCandidate(
        state.mergePath,
        mergeCandidate,
        state.originalMergeDns.present,
        state.originalMergeDns.value,
      );
      await createDnsCandidate(
        RUNTIME_PATH,
        runtimeCandidate,
        state.originalRuntimeDns.present,
        state.originalRuntimeDns.value,
      );
    }
    await validateRuntime(runtimeCandidate);
    await fs.rename(mergeCandidate, state.mergePath);
    await fs.rename(runtimeCandidate, RUNTIME_PATH);
    filesChanged = true;
    await reloadRuntime();
    await writeState({
      ...state,
      phase: 'disabled',
      enabled: false,
      changedAt: new Date().toISOString(),
      lastError: null,
    });
  } catch (error) {
    if (filesChanged) {
      await atomicRestore(backupMerge, state.mergePath).catch(() => null);
      await atomicRestore(backupRuntime, RUNTIME_PATH).catch(() => null);
      await reloadRuntime().catch(() => null);
    }
    await writeState({
      ...state,
      phase: 'enabled',
      enabled: true,
      changedAt: new Date().toISOString(),
      lastError: error.message,
    });
    throw error;
  } finally {
    await fs.rm(mergeCandidate, { force: true });
    await fs.rm(runtimeCandidate, { force: true });
  }
}

async function setProtection(enabled) {
  if (operationInProgress) throw new AppError('BUSY', '已有操作正在执行');
  operationInProgress = true;
  try {
    if (enabled) await enableProtection();
    else await disableProtection();
    latestDnsTest = null;
    return await buildStatus();
  } finally {
    operationInProgress = false;
  }
}

async function fetchJson(url, timeout = 12_000) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runNetCoffeeDnsTest(rounds = 5) {
  const token = crypto.randomBytes(18).toString('hex');
  let triggered = 0;
  for (let index = 1; index <= rounds; index += 1) {
    try {
      const response = await fetch(
        `https://${token}-${index}.d.ip.net.coffee/pixel.gif?_=${Date.now()}`,
        { cache: 'no-store', signal: AbortSignal.timeout(5_000) },
      );
      await response.arrayBuffer();
      triggered += 1;
    } catch {
      // DNS resolution can still complete even when the pixel request fails.
    }
    if (index < rounds) await delay(600);
  }

  await delay(2_000);
  let servers = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await fetchJson(`https://ip.net.coffee/api/dns/result/${token}`, 6_000);
      servers = Array.isArray(result?.dns_servers) ? result.dns_servers : [];
      if (servers.length) break;
    } catch {
      // Poll again because the authoritative DNS records arrive asynchronously.
    }
    if (attempt < 2) await delay(2_000);
  }

  const geoSettled = await Promise.allSettled(
    [...new Set(servers)].map((ip) => fetchJson(
      `https://ip.net.coffee/api/geoip/${encodeURIComponent(ip)}`,
      6_000,
    ).then((geo) => ({
      ip,
      organization: geo?.isp || '未知',
      country: geo?.country || '',
      countryCode: geo?.country_code || '',
      city: geo?.city || '',
    }))),
  );
  const resolvers = geoSettled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  return {
    resolvers,
    partial: !servers.length || triggered < rounds || resolvers.length < servers.length,
  };
}

async function runDnsTest() {
  const started = Date.now();
  let config;
  try {
    config = await fetchJson('https://am.i.mullvad.net/config');
  } catch {
    throw new AppError('DNS_TEST_UNAVAILABLE', '检测服务暂时不可用', 503);
  }
  if (!config?.dns_leak_domain) throw new AppError('DNS_TEST_UNAVAILABLE', '检测服务不可用');

  const queries = Array.from({ length: 6 }, () => {
    const id = crypto.randomUUID().replaceAll('-', '');
    return fetchJson(`https://${id}.${config.dns_leak_domain}`);
  });
  const [querySettled, publicSettled, netCoffeeSettled] = await Promise.all([
    Promise.allSettled(queries),
    fetchJson('https://am.i.mullvad.net/json')
      .then((value) => ({ ok: true, value }))
      .catch(() => ({ ok: false, value: {} })),
    runNetCoffeeDnsTest()
      .then((value) => ({ ok: true, value }))
      .catch(() => ({ ok: false, value: { resolvers: [], partial: true } })),
  ]);
  const queryResults = querySettled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  if (!queryResults.length) {
    throw new AppError('DNS_TEST_UNAVAILABLE', 'DNS 查询未返回结果', 503);
  }
  const publicInfo = publicSettled.value || {};

  const resolversByIp = new Map();
  queryResults.flat().forEach((resolver) => {
    if (resolver?.ip) {
      resolversByIp.set(resolver.ip, {
        ip: resolver.ip,
        organization: resolver.organization || '未知',
        country: resolver.country || '',
        countryCode: resolver.country_code || '',
        city: resolver.city || '',
      });
    }
  });

  const netCoffeeResult = netCoffeeSettled.value || { resolvers: [], partial: true };
  netCoffeeResult.resolvers.forEach((resolver) => {
    resolversByIp.set(resolver.ip, resolver);
  });

  let exitGeo = {};
  if (publicInfo.ip) {
    try {
      exitGeo = await fetchJson(
        `https://ip.net.coffee/api/geoip/${encodeURIComponent(publicInfo.ip)}`,
        6_000,
      );
    } catch {
      exitGeo = {};
    }
  }

  const status = await buildStatus();
  const resolvers = [...resolversByIp.values()];
  const publicExit = {
    ip: publicInfo.ip || null,
    organization: publicInfo.organization || '未知',
    country: publicInfo.country || exitGeo.country || '',
    countryCode: exitGeo.country_code || '',
    city: publicInfo.city || exitGeo.city || '',
  };
  const geoLeak = detectGeoDnsLeak(publicExit, resolvers);
  latestDnsTest = {
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    resolvers,
    publicExit,
    verdict: resolveDnsTestVerdict({
      geoLeaked: geoLeak.leaked,
      evidenceComplete: Boolean(publicExit.ip && resolvers.length),
      clientMode: status.client.mode,
      assessmentLevel: status.assessment.level,
    }),
    leakReason: geoLeak.leaked ? 'china-dns' : null,
    source: netCoffeeSettled.ok ? 'Mullvad + Net.Coffee' : 'Mullvad',
    partial: queryResults.length < queries.length
      || !publicSettled.ok
      || !netCoffeeSettled.ok
      || netCoffeeResult.partial,
  };
  return latestDnsTest;
}

class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8_192) throw new AppError('BODY_TOO_LARGE', '请求内容过大', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON', '请求格式无效');
  }
}

function applySecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function isAuthorized(request) {
  const token = request.headers['x-dns-guard-token'];
  return typeof token === 'string'
    && token.length === ACCESS_TOKEN.length
    && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ACCESS_TOKEN));
}

async function handleRequest(request, response) {
  applySecurityHeaders(response);
  const expectedHost = `${HOST}:${server.address().port}`;
  if (request.headers.host !== expectedHost) {
    throw new AppError('INVALID_HOST', '请求来源无效', 403);
  }

  const origin = request.headers.origin;
  if (origin && origin !== `http://${expectedHost}`) {
    throw new AppError('INVALID_ORIGIN', '请求来源无效', 403);
  }

  const url = new URL(request.url, `http://${expectedHost}`);
  if (!url.pathname.startsWith('/api/')) {
    throw new AppError('NOT_FOUND', '接口不存在', 404);
  }

  if (!isAuthorized(request)) {
    throw new AppError('UNAUTHORIZED', '本地访问令牌无效', 401);
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, await buildStatus());
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/dns-test') {
    sendJson(response, 200, await runDnsTest());
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/protection') {
    const body = await readJsonBody(request);
    if (typeof body.enabled !== 'boolean') {
      throw new AppError('INVALID_TOGGLE', '开关状态无效');
    }
    sendJson(response, 200, await setProtection(body.enabled));
    return;
  }

  throw new AppError('NOT_FOUND', '接口不存在', 404);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    sendJson(response, status, {
      error: code,
      message: error instanceof AppError ? error.message : '本地服务发生错误',
    });
    if (!(error instanceof AppError)) console.error(error);
  });
});

await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
await fs.chmod(DATA_DIR, 0o700);
await fs.chmod(BACKUP_DIR, 0o700);

server.listen(PORT, HOST, () => {
  const actualPort = server.address().port;
  const url = `http://${HOST}:${actualPort}/?token=${ACCESS_TOKEN}`;
  console.log(`DNS Guard running at ${url}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
