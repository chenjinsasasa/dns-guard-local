const elements = {
  statusHero: document.querySelector('#status-hero'),
  overallBadge: document.querySelector('#overall-badge'),
  overallTitle: document.querySelector('#overall-title'),
  overallMessage: document.querySelector('#overall-message'),
  updatedAt: document.querySelector('#updated-at'),
  refreshButton: document.querySelector('#refresh-button'),
  testButton: document.querySelector('#test-button'),
  protectionToggle: document.querySelector('#protection-toggle'),
  protectionDetail: document.querySelector('#protection-detail'),
  networkChip: document.querySelector('#network-chip'),
  networkInterface: document.querySelector('#network-interface'),
  localAddress: document.querySelector('#local-address'),
  networkGateway: document.querySelector('#network-gateway'),
  clashState: document.querySelector('#clash-state'),
  ipv6State: document.querySelector('#ipv6-state'),
  tailscaleState: document.querySelector('#tailscale-state'),
  dnsChip: document.querySelector('#dns-chip'),
  systemDns: document.querySelector('#system-dns'),
  dnsRoute: document.querySelector('#dns-route'),
  endpointCount: document.querySelector('#endpoint-count'),
  endpointList: document.querySelector('#endpoint-list'),
  dnsTestEmpty: document.querySelector('#dns-test-empty'),
  dnsTestResults: document.querySelector('#dns-test-results'),
  publicIp: document.querySelector('#public-ip'),
  publicLocation: document.querySelector('#public-location'),
  testLatency: document.querySelector('#test-latency'),
  resolverTableBody: document.querySelector('#resolver-table-body'),
  checksCount: document.querySelector('#checks-count'),
  checksGrid: document.querySelector('#checks-grid'),
  toast: document.querySelector('#toast'),
};

const queryToken = new URLSearchParams(window.location.search).get('token');
if (queryToken) {
  sessionStorage.setItem('dns-guard-token', queryToken);
  history.replaceState({}, '', '/');
}
const accessToken = queryToken || sessionStorage.getItem('dns-guard-token');

let currentStatus = null;
let refreshPending = false;
let testPending = false;
let togglePending = false;
let toastTimer = null;

const levelLabels = {
  safe: '安全',
  risk: '需检查',
  leak: '有风险',
  offline: '离线',
  loading: '检查中',
};

const endpointLabels = {
  encrypted: '加密',
  plaintext: '明文',
  system: '系统',
  local: '本地',
  unknown: '未知',
};

function text(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function formatLocation(city, country) {
  return [city, country].filter(Boolean).join(' · ') || '未知';
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function create(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function showToast(message, kind = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

async function api(path, options = {}) {
  if (!accessToken) throw new Error('请使用启动脚本打开页面');
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-dns-guard-token': accessToken,
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败：${response.status}`);
  return payload;
}

function setButtonBusy(button, busy, idleText, busyText) {
  button.disabled = busy;
  const label = button.querySelector('[data-button-label]');
  if (label) label.textContent = busy ? busyText : idleText;
}

function renderEndpoints(endpoints) {
  elements.endpointList.replaceChildren();
  elements.endpointCount.textContent = `${endpoints.length} 个`;
  if (!endpoints.length) {
    elements.endpointList.append(create('li', 'empty-row', '未读取到上游'));
    return;
  }

  endpoints.forEach((item) => {
    const row = create('li', 'endpoint-row');
    const value = create('span', 'endpoint-value', item.endpoint);
    value.title = item.endpoint;
    const type = create('span', 'endpoint-type', endpointLabels[item.transport] || '未知');
    type.dataset.state = item.transport;
    row.append(value, type);
    elements.endpointList.append(row);
  });
}

function renderChecks(checks) {
  elements.checksGrid.replaceChildren();
  const passed = checks.filter((item) => item.state === 'pass').length;
  elements.checksCount.textContent = `${passed}/${checks.length} 通过`;

  checks.forEach((item) => {
    const card = create('article', 'check-item');
    const top = create('div', 'check-topline');
    top.append(create('h3', '', item.label));
    const dot = create('span', 'check-dot');
    dot.dataset.state = item.state;
    dot.setAttribute('aria-label', item.state === 'pass' ? '通过' : item.state === 'fail' ? '失败' : '注意');
    top.append(dot);
    const value = create('p', 'check-value', item.value);
    const detail = create('p', 'check-detail', item.detail || '—');
    detail.title = item.detail || '';
    card.append(top, value, detail);
    elements.checksGrid.append(card);
  });
}

function renderDnsTest(result) {
  if (!result) {
    elements.dnsTestEmpty.hidden = false;
    elements.dnsTestResults.hidden = true;
    return;
  }

  elements.dnsTestEmpty.hidden = true;
  elements.dnsTestResults.hidden = false;
  elements.publicIp.textContent = text(result.publicExit?.ip);
  elements.publicIp.title = text(result.publicExit?.organization, '');
  elements.publicLocation.textContent = formatLocation(result.publicExit?.city, result.publicExit?.country);
  elements.testLatency.textContent = `${result.latencyMs} ms`;
  elements.resolverTableBody.replaceChildren();

  if (!result.resolvers?.length) {
    const row = create('tr');
    const cell = create('td', '', '未发现解析器');
    cell.colSpan = 3;
    row.append(cell);
    elements.resolverTableBody.append(row);
    return;
  }

  result.resolvers.forEach((resolver) => {
    const row = create('tr');
    const addressCell = create('td', '', text(resolver.ip));
    const organizationCell = create('td', '', text(resolver.organization, '未知'));
    const locationCell = create('td', '', formatLocation(resolver.city, resolver.country));
    addressCell.dataset.label = '地址';
    organizationCell.dataset.label = '运营商';
    locationCell.dataset.label = '位置';
    row.append(addressCell, organizationCell, locationCell);
    elements.resolverTableBody.append(row);
  });
}

function render(status) {
  currentStatus = status;
  const { assessment, network, clash, protection, tailscale } = status;
  const level = assessment.level || 'risk';
  elements.statusHero.dataset.level = level;
  elements.overallBadge.textContent = levelLabels[level] || '需检查';
  elements.overallBadge.dataset.state = level;
  elements.overallTitle.textContent = assessment.title;
  elements.overallMessage.textContent = assessment.message;
  elements.updatedAt.textContent = `更新于 ${formatTime(status.generatedAt)}`;

  elements.protectionToggle.checked = protection.enabled;
  elements.protectionToggle.disabled = !protection.available || protection.busy || togglePending;
  elements.protectionDetail.textContent = protection.enabled
    ? protection.effective ? '分流 DNS 已生效' : '配置需检查'
    : '加密并跟随代理';

  elements.networkChip.textContent = network.defaultInterface ? '已连接' : '未连接';
  elements.networkChip.dataset.state = network.defaultInterface ? 'pass' : 'fail';
  elements.networkInterface.textContent = text(network.defaultInterface);
  elements.localAddress.textContent = text(network.localIp);
  elements.networkGateway.textContent = text(network.gateway);
  elements.clashState.textContent = clash.running
    ? `${text(clash.mode, '运行中')} · ${text(clash.version, 'Mihomo')}`
    : '未运行';
  elements.ipv6State.textContent = network.ipv6Address ? '已启用' : '未启用';
  elements.tailscaleState.textContent = !tailscale.installed
    ? '未安装'
    : tailscale.running ? tailscale.exitNodeActive ? '出口节点' : '运行中' : '未连接';

  const transportCheck = assessment.checks.find((item) => item.id === 'transport');
  const routeCheck = assessment.checks.find((item) => item.id === 'dns-route');
  elements.dnsChip.textContent = transportCheck?.value || '需检查';
  elements.dnsChip.dataset.state = transportCheck?.state || 'warn';
  elements.systemDns.textContent = network.systemDns?.join(' · ') || '未读取';
  elements.systemDns.title = network.systemDns?.join(' · ') || '';
  elements.dnsRoute.textContent = routeCheck?.value || '需检查';
  renderEndpoints(assessment.endpoints || []);
  renderChecks(assessment.checks || []);
  renderDnsTest(status.dnsTest);
}

async function refreshStatus({ quiet = false } = {}) {
  if (refreshPending) return;
  refreshPending = true;
  setButtonBusy(elements.refreshButton, true, '刷新', '刷新中');
  try {
    render(await api('/api/status'));
  } catch (error) {
    if (!quiet) showToast(error.message, 'error');
    elements.statusHero.dataset.level = 'risk';
    elements.overallBadge.textContent = '异常';
    elements.overallTitle.textContent = '无法读取状态';
    elements.overallMessage.textContent = error.message;
  } finally {
    refreshPending = false;
    setButtonBusy(elements.refreshButton, false, '刷新', '刷新中');
  }
}

async function runLiveTest({ quiet = false } = {}) {
  if (testPending) return;
  testPending = true;
  setButtonBusy(elements.testButton, true, '检测', '检测中');
  try {
    const result = await api('/api/dns-test', { method: 'POST', body: '{}' });
    renderDnsTest(result);
    await refreshStatus({ quiet: true });
    if (!quiet) showToast(`发现 ${result.resolvers.length} 个 DNS 出口`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    testPending = false;
    setButtonBusy(elements.testButton, false, '检测', '检测中');
  }
}

async function toggleProtection() {
  if (togglePending || !currentStatus) return;
  const desired = elements.protectionToggle.checked;
  const previous = !desired;
  togglePending = true;
  elements.protectionToggle.disabled = true;
  elements.protectionDetail.textContent = desired ? '正在开启' : '正在恢复';
  try {
    const status = await api('/api/protection', {
      method: 'POST',
      body: JSON.stringify({ enabled: desired }),
    });
    render(status);
    showToast(desired ? '防泄漏已开启' : '原配置已恢复');
    if (desired) await runLiveTest({ quiet: true });
  } catch (error) {
    elements.protectionToggle.checked = previous;
    showToast(error.message, 'error');
    await refreshStatus({ quiet: true });
  } finally {
    togglePending = false;
    if (currentStatus) {
      elements.protectionToggle.disabled = !currentStatus.protection.available;
    }
  }
}

elements.refreshButton.addEventListener('click', () => refreshStatus());
elements.testButton.addEventListener('click', () => runLiveTest());
elements.protectionToggle.addEventListener('change', toggleProtection);

if (!accessToken) {
  elements.statusHero.dataset.level = 'risk';
  elements.overallBadge.textContent = '未授权';
  elements.overallTitle.textContent = '请重新启动';
  elements.overallMessage.textContent = '使用 start.command 打开页面';
  elements.refreshButton.disabled = true;
  elements.testButton.disabled = true;
  elements.protectionToggle.disabled = true;
} else {
  refreshStatus();
  setInterval(() => {
    if (document.visibilityState === 'visible' && !togglePending && !testPending) {
      refreshStatus({ quiet: true });
    }
  }, 10_000);
}
