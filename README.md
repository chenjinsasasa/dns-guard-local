# DNS 守卫

面向 macOS 的原生 DNS 状态面板、客户端识别、防泄漏保护和双源出口检测工具。

> DNS Guard Local — local-only DNS leak detection and protection for macOS.

## 解决的问题

使用代理或 VPN 时，网络流量可能已经从代理节点出站，但 DNS 查询仍交给本地网络、运营商或未受控的明文解析器。这类路径不一致就是常见的 DNS 泄漏，会暴露查询域名、造成区域判断异常，也可能让域名解析受到本地网络影响。

DNS 守卫用于发现并减少这类泄漏：

- 对比当前公网出口与真实 DNS 解析器的位置
- 检查系统 DNS 路由、TUN 接管、DNS 劫持和明文上游
- 在 Clash Verge Rev 完整防护模式中移除明文 DNS 与 `system` 回退，并让境外 DNS 跟随代理
- 对其他代理或 VPN 客户端提供只读识别和 DNS 出口检测，不修改其配置

检测结果代表测试发生时的 DNS 路径，不等同于对所有应用流量的永久保证。浏览器自带安全 DNS、WebRTC、扩展以及应用内置解析器不在当前检测范围内。

## 功能

- 查看活动接口、本机地址、默认网关和 IPv6 状态
- 使用原生 SwiftUI 窗口查看概览、防护、检测与明细
- 自动识别 Clash Verge、Clash Party、FlClash、Surge、Hiddify、sing-box、Tailscale 与 WireGuard
- 没有 Clash 时使用仅检测模式，不修改其他客户端配置
- 查看 Mihomo TUN、DNS 劫持、严格路由和上游加密状态
- 通过 Mullvad 与 Net.Coffee 检测真实 DNS 出口
- Clash Verge 完整防护可一键移除明文 DNS 与 `system` 回退
- 让境外 DNS 跟随代理，并让国内直连域名使用本地加密 DNS
- 关闭保护时恢复开启前的原始配置
- 修改前验证 Mihomo 配置，失败时自动回滚

## 运行要求

- macOS 13 或更高版本
- Node.js 22 或更高版本

使用 Homebrew 安装运行依赖：

```bash
brew install node
```

完整防护目前需要 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)、TUN 和 [`yq`](https://github.com/mikefarah/yq)。其他客户端目前提供识别或状态支持，DNS 检测功能不依赖 Clash。

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

## 客户端兼容

- Clash Verge Rev：完整防护、状态读取和配置恢复
- Clash Party、FlClash、Surge、Tailscale：首批状态识别
- Hiddify、sing-box、WireGuard：首批客户端识别
- 未识别客户端：系统网络与外部 DNS 检测

只有确认接入完整适配器时，应用才会显示防护开关。仅检测模式不会修改客户端配置。

## Clash 防泄漏策略

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
