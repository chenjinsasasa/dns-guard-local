import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const launcher = await fs.readFile(new URL('../macos/DNSGuardLauncher.swift', import.meta.url), 'utf8');
const views = await fs.readFile(new URL('../macos/DashboardViews.swift', import.meta.url), 'utf8');
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

test('does not bundle the retired web interface', () => {
  assert.doesNotMatch(buildScript, /public\/index\.html|public\/styles\.css|public\/app\.js/);
  assert.doesNotMatch(server, /serveStatic|PUBLIC_DIR/);
});

test('verifies native packaging before install and archive', () => {
  assert.match(installScript, /verify-macos-app\.sh/);
  assert.match(packageScript, /verify-macos-app\.sh/);
});

test('keeps native and backend versions aligned', () => {
  assert.match(server, new RegExp(`APP_VERSION = '${packageDocument.version.replaceAll('.', '\\.')}'`));
});
