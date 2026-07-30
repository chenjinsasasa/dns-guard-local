import { isIP } from 'node:net';

export const MANAGED_DNS = Object.freeze({
  enable: true,
  'use-system-hosts': false,
  'respect-rules': true,
  'default-nameserver': [
    'tls://1.1.1.1',
    'tls://8.8.8.8',
  ],
  nameserver: [
    'https://cloudflare-dns.com/dns-query',
    'https://dns.google/dns-query',
  ],
  'proxy-server-nameserver': [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query',
  ],
  'direct-nameserver': [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query',
  ],
  'direct-nameserver-follow-policy': false,
  'nameserver-policy': {
    'geosite:private,cn': [
      'https://dns.alidns.com/dns-query',
      'https://doh.pub/dns-query',
    ],
  },
  'proxy-server-nameserver-policy': {},
  fallback: [],
});

const DNS_ENDPOINT_FIELDS = [
  'default-nameserver',
  'nameserver',
  'proxy-server-nameserver',
  'direct-nameserver',
  'fallback',
  'nameserver-policy',
  'proxy-server-nameserver-policy',
];

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function buildManagedDns(existing = {}) {
  const base = existing && typeof existing === 'object' ? clone(existing) : {};
  return {
    ...base,
    ...clone(MANAGED_DNS),
    enable: true,
    listen: base.listen || ':53',
    ipv6: base.ipv6 ?? false,
    'enhanced-mode': base['enhanced-mode'] || 'fake-ip',
    'fake-ip-range': base['fake-ip-range'] || '198.18.0.1/16',
  };
}

function flattenStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenStrings(item, output));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => flattenStrings(item, output));
  }
}

export function classifyDnsEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  const normalized = raw.split('#')[0].toLowerCase();

  if (!normalized) return 'unknown';
  if (normalized === 'system' || normalized === 'system://' || normalized.startsWith('dhcp://')) {
    return 'system';
  }
  if (
    normalized.startsWith('https://')
    || normalized.startsWith('tls://')
    || normalized.startsWith('quic://')
    || normalized.startsWith('h3://')
  ) {
    return 'encrypted';
  }
  if (normalized.startsWith('rcode://')) return 'local';
  if (
    normalized.startsWith('udp://')
    || normalized.startsWith('tcp://')
    || isIP(normalized) > 0
  ) {
    return 'plaintext';
  }
  return 'unknown';
}

export function collectDnsEndpoints(dns = {}) {
  const values = [];
  for (const field of DNS_ENDPOINT_FIELDS) {
    flattenStrings(dns?.[field], values);
  }

  const unique = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  return unique.map((endpoint) => ({
    endpoint,
    transport: classifyDnsEndpoint(endpoint),
  }));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function sameValue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function parseDefaultRoute(output = '') {
  const gateway = output.match(/^\s*gateway:\s*(.+)$/m)?.[1]?.trim() || null;
  const interfaceName = output.match(/^\s*interface:\s*(.+)$/m)?.[1]?.trim() || null;
  return { gateway, interface: interfaceName };
}

export function parseSystemDns(output = '') {
  return [...new Set(
    [...output.matchAll(/^\s*nameserver\[\d+\]\s*:\s*(.+)$/gm)]
      .map((match) => match[1].trim())
      .filter(Boolean),
  )];
}

export function parseRouteInterface(output = '') {
  return output.match(/^\s*interface:\s*(.+)$/m)?.[1]?.trim() || null;
}

const NETWORK_CLIENT_CATALOG = [
  {
    id: 'clash-verge',
    name: 'Clash Verge Rev',
    family: 'mihomo',
    compatibility: 'full',
    appPaths: ['/Applications/Clash Verge.app'],
    processPatterns: ['Clash Verge.app/Contents/MacOS/Clash Verge', 'verge-mihomo'],
  },
  {
    id: 'clash-party',
    name: 'Clash Party',
    family: 'mihomo',
    compatibility: 'status',
    appPaths: ['/Applications/Clash Party.app', '/Applications/Mihomo Party.app'],
    processPatterns: [
      'Clash Party.app/Contents/MacOS/Clash Party',
      'Mihomo Party.app/Contents/MacOS/Mihomo Party',
    ],
  },
  {
    id: 'flclash',
    name: 'FlClash',
    family: 'mihomo',
    compatibility: 'status',
    appPaths: ['/Applications/FlClash.app'],
    processPatterns: ['FlClash.app/Contents/MacOS/FlClash'],
  },
  {
    id: 'surge',
    name: 'Surge',
    family: 'surge',
    compatibility: 'status',
    appPaths: ['/Applications/Surge.app'],
    processPatterns: ['Surge.app/Contents/MacOS/Surge'],
  },
  {
    id: 'hiddify',
    name: 'Hiddify',
    family: 'sing-box',
    compatibility: 'detect',
    appPaths: ['/Applications/Hiddify.app'],
    processPatterns: ['Hiddify.app/Contents/MacOS/Hiddify'],
  },
  {
    id: 'sing-box',
    name: 'sing-box',
    family: 'sing-box',
    compatibility: 'detect',
    appPaths: ['/Applications/SFM.app', '/Applications/SFI.app', '/Applications/sing-box.app'],
    processPatterns: [
      'SFM.app/Contents/MacOS/SFM',
      'SFI.app/Contents/MacOS/SFI',
      'sing-box.app/Contents/MacOS/sing-box',
    ],
  },
  {
    id: 'tailscale',
    name: 'Tailscale',
    family: 'vpn',
    compatibility: 'status',
    appPaths: ['/Applications/Tailscale.app'],
    processPatterns: ['Tailscale.app/Contents/MacOS/Tailscale', 'IPNExtension'],
  },
  {
    id: 'wireguard',
    name: 'WireGuard',
    family: 'vpn',
    compatibility: 'detect',
    appPaths: ['/Applications/WireGuard.app'],
    processPatterns: ['WireGuard.app/Contents/MacOS/WireGuard'],
  },
];

export function detectNetworkClients({
  installedPaths = [],
  processOutput = '',
  clashRunning = false,
} = {}) {
  const installed = new Set(installedPaths);
  const installedNames = new Set(
    installedPaths.map((appPath) => String(appPath).split('/').filter(Boolean).at(-1)),
  );
  const processes = String(processOutput).toLowerCase();
  const clients = NETWORK_CLIENT_CATALOG.map((candidate) => {
    const processMatches = candidate.processPatterns.some(
      (pattern) => processes.includes(pattern.toLowerCase()),
    );
    return {
      id: candidate.id,
      name: candidate.name,
      family: candidate.family,
      compatibility: candidate.compatibility,
      installed: candidate.appPaths.some((appPath) => (
        installed.has(appPath)
        || installedNames.has(appPath.split('/').at(-1))
      )),
      running: candidate.id === 'clash-verge' ? clashRunning || processMatches : processMatches,
    };
  }).filter((client) => client.installed || client.running);
  const primary = clients.find(
    (client) => client.running && client.compatibility === 'full',
  ) || clients.find((client) => client.running) || clients[0] || {
    id: 'system',
    name: '系统网络',
    family: 'system',
    compatibility: 'detect',
    installed: true,
    running: true,
  };

  return {
    mode: primary.id === 'clash-verge' && clashRunning ? 'managed' : 'monitor',
    primary,
    clients,
  };
}

export function detectGeoDnsLeak(publicExit = {}, resolvers = []) {
  const exitCode = String(publicExit.countryCode || '').toLowerCase();
  const exitCountry = String(publicExit.country || '').trim().toLowerCase();
  const exitIsChina = exitCode === 'cn' || exitCountry === 'china';
  const chinaResolvers = resolvers.filter((resolver) => {
    const resolverCode = String(resolver.countryCode || '').toLowerCase();
    const resolverCountry = String(resolver.country || '').trim().toLowerCase();
    return resolverCode === 'cn' || resolverCountry === 'china';
  });
  const exitKnown = Boolean(exitCode || exitCountry);
  return {
    leaked: exitKnown && !exitIsChina && chinaResolvers.length > 0,
    chinaResolverCount: chinaResolvers.length,
  };
}

export function resolveDnsTestVerdict({
  geoLeaked = false,
  evidenceComplete = false,
  clientMode = 'monitor',
  assessmentLevel = 'risk',
} = {}) {
  if (geoLeaked) return 'leak';
  if (clientMode === 'managed') return assessmentLevel;
  return evidenceComplete ? 'safe' : 'risk';
}

function check(id, label, state, value, detail = '') {
  return { id, label, state, value, detail };
}

function assessMonitorSnapshot(snapshot) {
  const network = snapshot.network || {};
  const client = snapshot.client || {};
  const primary = client.primary || {
    id: 'system',
    name: '系统网络',
    compatibility: 'detect',
    running: true,
  };
  const routedDns = Array.isArray(network.dnsRoutes) ? network.dnsRoutes : [];
  const capturedRoutes = routedDns.filter(
    (route) => String(route.interface || '').startsWith('utun'),
  );
  const clientRecognized = primary.id !== 'system';
  const clientValue = clientRecognized
    ? primary.running ? primary.name : `${primary.name} 未运行`
    : '仅检测';
  const compatibilityDetail = primary.compatibility === 'status'
    ? '支持状态检测'
    : clientRecognized ? '支持客户端识别' : '未发现完整防护引擎';
  const checks = [
    check(
      'network',
      '网络链路',
      network.defaultInterface ? 'pass' : 'fail',
      network.defaultInterface ? '已连接' : '未连接',
      network.defaultInterface || '没有默认路由',
    ),
    check(
      'client',
      '代理客户端',
      'warn',
      clientValue,
      compatibilityDetail,
    ),
    check(
      'dns-route',
      'DNS 路由',
      capturedRoutes.length ? 'pass' : 'warn',
      capturedRoutes.length ? '经过隧道' : '等待检测',
      routedDns.map((route) => `${route.server} → ${route.interface || '未知'}`).join(' · '),
    ),
    check(
      'ipv6',
      'IPv6',
      network.ipv6Address ? 'warn' : 'pass',
      network.ipv6Address ? '需检测' : '未启用',
      network.ipv6Address || '当前网络无 IPv6 地址',
    ),
  ];

  return {
    level: network.defaultInterface ? 'risk' : 'offline',
    title: network.defaultInterface ? '可进行 DNS 检测' : '网络未连接',
    message: network.defaultInterface ? '当前为仅检测模式' : '没有检测到默认网络路由',
    checks,
    endpoints: [],
    counts: { encrypted: 0, plaintext: 0, system: 0, unknown: 0 },
  };
}

export function assessSnapshot(snapshot) {
  const network = snapshot.network || {};
  const clash = snapshot.clash || {};
  if (snapshot.client?.mode === 'monitor' && !clash.running) {
    return assessMonitorSnapshot(snapshot);
  }
  const tun = clash.tun || {};
  const endpoints = collectDnsEndpoints(clash.dns || {});
  const plaintext = endpoints.filter((item) => item.transport === 'plaintext');
  const system = endpoints.filter((item) => item.transport === 'system');
  const unknown = endpoints.filter((item) => item.transport === 'unknown');
  const encrypted = endpoints.filter((item) => item.transport === 'encrypted');
  const dnsHijack = Array.isArray(tun['dns-hijack']) ? tun['dns-hijack'].map(String) : [];
  const hijacksUdp = dnsHijack.some((value) => value === 'any:53' || value === '0.0.0.0:53' || value === 'udp://any:53');
  const hijacksTcp = dnsHijack.some((value) => value.includes('tcp://') && value.endsWith(':53'));
  const routedDns = Array.isArray(network.dnsRoutes) ? network.dnsRoutes : [];
  const uncapturedRoutes = routedDns.filter((route) => route.interface && !route.interface.startsWith('utun'));
  const hasIpv6 = Boolean(network.ipv6Address);
  const tunIpv6 = tun.ipv6 === true || clash.ipv6 === true || Boolean(tun['inet6-address']);
  const dnsFollowsRules = clash.dns?.['respect-rules'] === true;

  const checks = [
    check(
      'network',
      '网络链路',
      network.defaultInterface ? 'pass' : 'fail',
      network.defaultInterface ? '已连接' : '未连接',
      network.defaultInterface || '没有默认路由',
    ),
    check(
      'clash',
      'Clash 内核',
      clash.running ? 'pass' : 'fail',
      clash.running ? '运行中' : '未运行',
      clash.version || '',
    ),
    check(
      'tun',
      'TUN 接管',
      tun.enable === true ? 'pass' : 'fail',
      tun.enable === true ? '已开启' : '未开启',
      tun.device || '',
    ),
    check(
      'hijack',
      'DNS 劫持',
      hijacksUdp && hijacksTcp ? 'pass' : 'fail',
      hijacksUdp && hijacksTcp ? '完整' : '不完整',
      dnsHijack.join(' · '),
    ),
    check(
      'strict-route',
      '严格路由',
      tun['strict-route'] === true ? 'pass' : 'warn',
      tun['strict-route'] === true ? '已开启' : '未开启',
      '限制旁路访问',
    ),
    check(
      'transport',
      'DNS 加密',
      plaintext.length || system.length ? 'fail' : encrypted.length ? 'pass' : 'warn',
      plaintext.length || system.length ? '存在明文' : encrypted.length ? '全部加密' : '无法确认',
      `${encrypted.length} 个加密上游`,
    ),
    check(
      'dns-policy',
      'DNS 分流',
      dnsFollowsRules ? 'pass' : 'warn',
      dnsFollowsRules ? '已开启' : '未开启',
      dnsFollowsRules ? '代理与直连分别解析' : '加密上游仍可能暴露本地位置',
    ),
    check(
      'dns-route',
      'DNS 路由',
      !routedDns.length ? 'warn' : uncapturedRoutes.length ? 'fail' : 'pass',
      !routedDns.length ? '无法确认' : uncapturedRoutes.length ? '存在旁路' : '已接管',
      routedDns.map((route) => `${route.server} → ${route.interface || '未知'}`).join(' · '),
    ),
    check(
      'ipv6',
      'IPv6',
      !hasIpv6 ? 'pass' : tunIpv6 ? 'pass' : 'warn',
      !hasIpv6 ? '未启用' : tunIpv6 ? '已接管' : '需检查',
      hasIpv6 ? network.ipv6Address : '当前网络无 IPv6 地址',
    ),
  ];

  let level = 'safe';
  let title = 'DNS 路径安全';
  let message = '解析请求已加密并按规则分流';

  if (!network.defaultInterface) {
    level = 'offline';
    title = '网络未连接';
    message = '没有检测到默认网络路由';
  } else if (plaintext.length || system.length || uncapturedRoutes.length || (tun.enable && (!hijacksUdp || !hijacksTcp))) {
    level = 'leak';
    title = '存在泄漏风险';
    message = plaintext.length || system.length
      ? '发现明文或系统 DNS 上游'
      : '发现未被 TUN 接管的 DNS 路径';
  } else if (!dnsFollowsRules) {
    level = 'risk';
    title = 'DNS 未跟随代理';
    message = '加密查询仍可能暴露本地位置';
  } else if (checks.some((item) => item.state === 'fail' || item.state === 'warn') || unknown.length) {
    level = 'risk';
    title = '网络需要检查';
    message = '部分保护状态尚未确认';
  }

  return {
    level,
    title,
    message,
    checks,
    endpoints,
    counts: {
      encrypted: encrypted.length,
      plaintext: plaintext.length,
      system: system.length,
      unknown: unknown.length,
    },
  };
}
