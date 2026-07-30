import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessSnapshot,
  detectNetworkClients,
  resolveDnsTestVerdict,
} from '../core.mjs';

test('selects a running non-Clash client in monitor-only mode', () => {
  const result = detectNetworkClients({
    installedPaths: ['/Applications/Hiddify.app'],
    processOutput: '/Applications/Hiddify.app/Contents/MacOS/Hiddify',
    clashRunning: false,
  });

  assert.equal(result.mode, 'monitor');
  assert.equal(result.primary.id, 'hiddify');
  assert.equal(result.primary.name, 'Hiddify');
  assert.equal(result.primary.compatibility, 'detect');
  assert.equal(result.primary.running, true);
});

test('prefers confirmed Clash Verge full protection when multiple clients are running', () => {
  const result = detectNetworkClients({
    installedPaths: [
      '/Applications/Clash Verge.app',
      '/Applications/Hiddify.app',
    ],
    processOutput: [
      '/Applications/Clash Verge.app/Contents/MacOS/Clash Verge',
      '/Applications/Hiddify.app/Contents/MacOS/Hiddify',
    ].join('\n'),
    clashRunning: true,
  });

  assert.equal(result.mode, 'managed');
  assert.equal(result.primary.id, 'clash-verge');
  assert.equal(result.primary.compatibility, 'full');
  assert.equal(result.clients.length, 2);
});

test('keeps process-only Clash detection in monitor mode until the adapter is confirmed', () => {
  const result = detectNetworkClients({
    installedPaths: ['/Applications/Clash Verge.app'],
    processOutput: '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo',
    clashRunning: false,
  });

  assert.equal(result.primary.id, 'clash-verge');
  assert.equal(result.primary.running, true);
  assert.equal(result.mode, 'monitor');
});

test('reports the first supported macOS client catalog with compatibility levels', () => {
  const installedPaths = [
    '/Applications/Clash Party.app',
    '/Applications/FlClash.app',
    '/Applications/Surge.app',
    '/Applications/Hiddify.app',
    '/Applications/SFM.app',
    '/Applications/Tailscale.app',
    '/Applications/WireGuard.app',
  ];
  const result = detectNetworkClients({ installedPaths });
  const compatibility = Object.fromEntries(
    result.clients.map((client) => [client.id, client.compatibility]),
  );

  assert.deepEqual(compatibility, {
    'clash-party': 'status',
    flclash: 'status',
    surge: 'status',
    hiddify: 'detect',
    'sing-box': 'detect',
    tailscale: 'status',
    wireguard: 'detect',
  });
  assert.equal(result.mode, 'monitor');
});

test('assesses connected users without Clash in monitor-only mode instead of failing', () => {
  const client = detectNetworkClients();
  const assessment = assessSnapshot({
    client,
    network: {
      defaultInterface: 'en0',
      dnsRoutes: [{ server: '192.168.1.1', interface: 'en0' }],
      ipv6Address: null,
    },
    clash: { running: false, dns: {}, tun: {}, ipv6: false },
  });

  assert.equal(assessment.level, 'risk');
  assert.equal(assessment.title, '可进行 DNS 检测');
  assert.equal(assessment.checks.some((item) => item.id === 'clash'), false);
  assert.deepEqual(
    assessment.checks.find((item) => item.id === 'client'),
    {
      id: 'client',
      label: '代理客户端',
      state: 'warn',
      value: '仅检测',
      detail: '未发现完整防护引擎',
    },
  );
});

test('lets complete external evidence produce a safe verdict in monitor-only mode', () => {
  assert.equal(resolveDnsTestVerdict({
    geoLeaked: false,
    evidenceComplete: true,
    clientMode: 'monitor',
    assessmentLevel: 'risk',
  }), 'safe');
  assert.equal(resolveDnsTestVerdict({
    geoLeaked: false,
    evidenceComplete: false,
    clientMode: 'monitor',
    assessmentLevel: 'risk',
  }), 'risk');
  assert.equal(resolveDnsTestVerdict({
    geoLeaked: false,
    evidenceComplete: true,
    clientMode: 'managed',
    assessmentLevel: 'leak',
  }), 'leak');
});
