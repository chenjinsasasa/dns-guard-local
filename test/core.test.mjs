import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessSnapshot,
  buildManagedDns,
  classifyDnsEndpoint,
  collectDnsEndpoints,
  detectGeoDnsLeak,
  parseDefaultRoute,
  parseSystemDns,
  sameValue,
} from '../core.mjs';

test('classifies encrypted, plaintext and system DNS transports', () => {
  assert.equal(classifyDnsEndpoint('https://dns.alidns.com/dns-query'), 'encrypted');
  assert.equal(classifyDnsEndpoint('tls://223.5.5.5'), 'encrypted');
  assert.equal(classifyDnsEndpoint('quic://dns.adguard.com:784'), 'encrypted');
  assert.equal(classifyDnsEndpoint('8.8.8.8'), 'plaintext');
  assert.equal(classifyDnsEndpoint('tcp://8.8.8.8'), 'plaintext');
  assert.equal(classifyDnsEndpoint('system'), 'system');
});

test('collects endpoints from policies without scanning unrelated DNS fields', () => {
  const endpoints = collectDnsEndpoints({
    nameserver: ['https://doh.pub/dns-query'],
    'nameserver-policy': {
      '+.internal.test': '10.0.0.1',
    },
    'fake-ip-filter': ['+.lan'],
  });
  assert.deepEqual(endpoints, [
    { endpoint: 'https://doh.pub/dns-query', transport: 'encrypted' },
    { endpoint: '10.0.0.1', transport: 'plaintext' },
  ]);
});

test('managed DNS removes plaintext and system fallbacks while preserving mode', () => {
  const managed = buildManagedDns({
    listen: ':53',
    ipv6: false,
    'enhanced-mode': 'fake-ip',
    'fake-ip-filter': ['+.lan'],
    nameserver: ['8.8.8.8', 'system'],
  });
  const endpoints = collectDnsEndpoints(managed);
  assert.equal(endpoints.some((item) => item.transport === 'plaintext'), false);
  assert.equal(endpoints.some((item) => item.transport === 'system'), false);
  assert.deepEqual(managed['fake-ip-filter'], ['+.lan']);
  assert.equal(managed['enhanced-mode'], 'fake-ip');
  assert.equal(managed['respect-rules'], true);
  assert.deepEqual(managed.nameserver, [
    'https://cloudflare-dns.com/dns-query',
    'https://dns.google/dns-query',
  ]);
  assert.deepEqual(managed['proxy-server-nameserver'], [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query',
  ]);
  assert.deepEqual(managed['direct-nameserver'], [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query',
  ]);
  assert.equal(managed['direct-nameserver-follow-policy'], false);
  assert.deepEqual(managed['nameserver-policy']['geosite:private,cn'], [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query',
  ]);
});

test('keeps domestic direct DNS separate from proxied DNS', () => {
  const managed = buildManagedDns({});
  assert.notDeepEqual(managed.nameserver, managed['direct-nameserver']);
  assert.equal(managed.nameserver.every((endpoint) => (
    endpoint.includes('cloudflare') || endpoint.includes('google')
  )), true);
  assert.equal(managed['direct-nameserver'].every((endpoint) => (
    endpoint.includes('alidns') || endpoint.includes('doh.pub')
  )), true);
  assert.equal(managed['nameserver-policy']['geosite:private,cn'].every((endpoint) => (
    endpoint.includes('alidns') || endpoint.includes('doh.pub')
  )), true);
});

test('detects mainland DNS when the public exit is outside China', () => {
  assert.deepEqual(detectGeoDnsLeak(
    { countryCode: 'us', country: 'United States' },
    [
      { ip: '14.215.166.121', countryCode: 'cn', country: 'China' },
      { ip: '172.70.213.36', countryCode: 'us', country: 'United States' },
    ],
  ), { leaked: true, chinaResolverCount: 1 });
  assert.equal(detectGeoDnsLeak(
    { countryCode: 'cn', country: 'China' },
    [{ countryCode: 'cn', country: 'China' }],
  ).leaked, false);
});

test('parses macOS route and resolver output', () => {
  assert.deepEqual(parseDefaultRoute(`
    gateway: 192.168.31.1
  interface: en1
  `), { gateway: '192.168.31.1', interface: 'en1' });
  assert.deepEqual(parseSystemDns(`
    nameserver[0] : 114.114.114.114
    nameserver[0] : 114.114.114.114
    nameserver[1] : 1.1.1.1
  `), ['114.114.114.114', '1.1.1.1']);
});

test('reports a leak when runtime includes plaintext DNS', () => {
  const assessment = assessSnapshot({
    network: {
      defaultInterface: 'en1',
      dnsRoutes: [{ server: '114.114.114.114', interface: 'utun1024' }],
    },
    clash: {
      running: true,
      dns: { nameserver: ['8.8.8.8', 'https://doh.pub/dns-query'] },
      tun: {
        enable: true,
        device: 'utun1024',
        'strict-route': true,
        'dns-hijack': ['any:53', 'tcp://any:53'],
      },
    },
  });
  assert.equal(assessment.level, 'leak');
  assert.equal(assessment.counts.plaintext, 1);
});

test('reports safe when TUN captures DNS and every upstream is encrypted', () => {
  const assessment = assessSnapshot({
    network: {
      defaultInterface: 'en1',
      dnsRoutes: [{ server: '114.114.114.114', interface: 'utun1024' }],
      ipv6Address: null,
    },
    clash: {
      running: true,
      dns: buildManagedDns({}),
      tun: {
        enable: true,
        device: 'utun1024',
        'strict-route': true,
        'dns-hijack': ['any:53', 'tcp://any:53'],
      },
    },
  });
  assert.equal(assessment.level, 'safe');
});

test('reports risk when encrypted DNS does not follow routing rules', () => {
  const managed = buildManagedDns({});
  managed['respect-rules'] = false;
  const assessment = assessSnapshot({
    network: {
      defaultInterface: 'en1',
      dnsRoutes: [{ server: '114.114.114.114', interface: 'utun1024' }],
      ipv6Address: null,
    },
    clash: {
      running: true,
      dns: managed,
      tun: {
        enable: true,
        device: 'utun1024',
        'strict-route': true,
        'dns-hijack': ['any:53', 'tcp://any:53'],
      },
    },
  });
  assert.equal(assessment.level, 'risk');
  assert.equal(assessment.checks.find((item) => item.id === 'dns-policy').state, 'warn');
});

test('compares DNS objects without depending on key order', () => {
  assert.equal(sameValue({ b: 2, a: [1] }, { a: [1], b: 2 }), true);
});
