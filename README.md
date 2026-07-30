# DNS 守卫

面向 macOS 与 Clash Verge Rev 的原生 DNS 状态面板、防泄漏开关和双源出口检测工具。

> DNS Guard Local — local-only DNS leak visibility and protection for Mihomo/Clash Verge Rev.

## 功能

- 查看活动接口、本机地址、默认网关和 IPv6 状态
- 使用原生 SwiftUI 窗口查看概览、防护、检测与明细
- 查看 Mihomo TUN、DNS 劫持、严格路由和上游加密状态
- 通过 Mullvad 与 Net.Coffee 检测真实 DNS 出口
- 一键移除明文 DNS 与 `system` 回退
- 让境外 DNS 跟随代理，并让国内直连域名使用本地加密 DNS
- 关闭保护时恢复开启前的原始配置
- 修改前验证 Mihomo 配置，失败时自动回滚

## 运行要求

- macOS 13 或更高版本
- [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)，并开启 TUN
- Node.js 22 或更高版本
- [`yq`](https://github.com/mikefarah/yq)

使用 Homebrew 安装运行依赖：

```bash
brew install node yq
```

## 本机安装

```bash
git clone https://github.com/chenjinsasasa/dns-guard-local.git
cd dns-guard-local
./scripts/install-local.sh
```

安装完成后，从 `~/Applications/DNS守卫.app` 启动。应用常驻菜单栏；关闭窗口不会停止保护服务。

也可以双击 `一键启动.command`。首次使用会完成本机安装，之后直接打开原生应用。

## 未签名版本

当前 GitHub Release 是 ad-hoc 签名、未经过 Apple notarization 的社区构建。下载后 macOS 可能阻止首次启动。

确认下载来源和校验值后，先尝试打开应用，再进入：

`系统设置 → 隐私与安全性 → 安全性 → 仍要打开`

项目不会自动关闭 Gatekeeper，也不会自动移除下载文件的 quarantine 属性。

## 防泄漏策略

- 代理查询：Cloudflare 与 Google DoH，遵循 Mihomo 路由规则
- 引导查询：Cloudflare 与 Google DoT
- 国内直连与节点域名：AliDNS 与 DNSPod DoH
- `geosite:private,cn`：强制使用国内加密 DNS，避免中国站点命中境外 CDN
- 系统 DNS：由 TUN 的 UDP/TCP 53 劫持接管

工具会同时更新当前订阅关联的 Merge 扩展和 Clash 运行配置，再通过本地 Unix Socket 热重载 Mihomo。

## 安全边界

- 服务只监听 `127.0.0.1`
- API 使用每次启动生成的随机令牌
- API 拒绝非本机 Host、跨站 Origin 和无令牌请求
- 原生界面不使用浏览器、WebView 或第三方 UI 组件
- 运行数据保存在 `~/Library/Application Support/DNS Guard/`
- `data/`、配置备份、访问令牌和个人路径不会进入 Git
- 只有点击“检测”或开启保护后的复测会连接 Mullvad 与 Net.Coffee

本项目保护 DNS 解析路径，不等同于 VPN，也不检测 WebRTC、浏览器扩展或应用自身的代理绕过。

## 开发与验证

```bash
npm test
npm run build:mac
npm run package:mac
```

`npm start` 仅用于调试本地 API。测试包含纯逻辑回归、原生界面约束，以及在本机存在 Clash Verge 时执行的真实 Mihomo 配置预检。

## 卸载

```bash
./scripts/uninstall-local.sh
```

卸载默认保留配置备份。需要同时清理运行数据时：

```bash
./scripts/uninstall-local.sh --purge-data
```

## 许可证

[MIT](LICENSE)
