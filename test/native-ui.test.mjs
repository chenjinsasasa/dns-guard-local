import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const launcher = await fs.readFile(new URL('../macos/DNSGuardLauncher.swift', import.meta.url), 'utf8');
const views = await fs.readFile(new URL('../macos/DashboardViews.swift', import.meta.url), 'utf8');
const models = await fs.readFile(new URL('../macos/DNSGuardModels.swift', import.meta.url), 'utf8');
const buildScript = await fs.readFile(new URL('../scripts/build-macos-app.sh', import.meta.url), 'utf8');
const installScript = await fs.readFile(new URL('../scripts/install-local.sh', import.meta.url), 'utf8');
const packageScript = await fs.readFile(new URL('../scripts/package-unsigned.sh', import.meta.url), 'utf8');
const packageDocument = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const server = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');

test('uses a native SwiftUI window without browser embedding', () => {
  assert.match(views, /NavigationSplitView/);
  assert.match(views, /Table\(result\.resolvers\)/);
  assert.doesNotMatch(launcher, /NSWorkspace\.shared\.open/);
  assert.doesNotMatch(`${launcher}\n${views}`, /WKWebView|WebKit/);
});

test('exposes feedback and developer links in the About page', () => {
  assert.match(views, /dns-guard-local\/issues\/new/);
  assert.match(views, /github\.com\/chenjinsasasa/);
  assert.match(views, /DeveloperAvatar/);
});

test('presents detected clients without hard-coding Clash in the overview', () => {
  assert.match(models, /let client: ClientSnapshot/);
  assert.match(views, /title: "代理客户端"/);
  assert.match(views, /仅检测模式/);
  assert.doesNotMatch(views, /title: "Clash"/);
});

test('does not bundle the retired web interface', () => {
  assert.doesNotMatch(buildScript, /public\/index\.html|public\/styles\.css|public\/app\.js/);
  assert.doesNotMatch(server, /serveStatic|PUBLIC_DIR/);
});

test('verifies native packaging before install and archive', () => {
  assert.match(installScript, /verify-macos-app\.sh/);
  assert.match(packageScript, /verify-macos-app\.sh/);
});

test('allows monitor-only installation without Clash-specific dependencies', () => {
  assert.doesNotMatch(installScript, /if \[\[ -z "\$YQ_BIN" \]\]/);
  assert.doesNotMatch(installScript, /未找到 Clash Verge Rev，请先安装并启动 TUN/);
  assert.match(installScript, /仅检测模式/);
});

test('keeps native and backend versions aligned', () => {
  assert.match(server, new RegExp(`APP_VERSION = '${packageDocument.version.replaceAll('.', '\\.')}'`));
});
