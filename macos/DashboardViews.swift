import AppKit
import SwiftUI

struct NativeDashboardView: View {
    @ObservedObject var store: DashboardStore

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                SidebarBrand()
                List(SidebarSection.allCases, selection: $store.selection) { section in
                    Label(section.rawValue, systemImage: section.symbol)
                        .tag(section)
                        .padding(.vertical, 3)
                }
                .listStyle(.sidebar)
            }
            .navigationSplitViewColumnWidth(min: 176, ideal: 196, max: 224)
        } detail: {
            Group {
                if let status = store.status {
                    detailView(status)
                } else {
                    LoadingView(isConnected: store.isConnected)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        store.refresh()
                    } label: {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }
                    .disabled(!store.isConnected || store.isBusy)

                    Button {
                        store.selection = .test
                        store.runTest()
                    } label: {
                        Label(store.isTesting ? "检测中" : "检测", systemImage: "waveform.path.ecg")
                    }
                    .disabled(!store.isConnected || store.isBusy)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 900, minHeight: 640)
        .alert(item: $store.alert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("好"))
            )
        }
    }

    @ViewBuilder
    private func detailView(_ status: DNSGuardStatus) -> some View {
        switch store.selection {
        case .overview:
            OverviewView(store: store, status: status)
        case .protection:
            ProtectionView(store: store, status: status)
        case .test:
            TestView(store: store, status: status)
        case .details:
            DetailsView(status: status)
        case .about:
            AboutView(status: status)
        }
    }
}

private struct SidebarBrand: View {
    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 20, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.green)
                .frame(width: 34, height: 34)
                .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 1) {
                Text("DNS 守卫")
                    .font(.headline)
                Text("本机防护")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }
}

private struct LoadingView: View {
    let isConnected: Bool

    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
                .controlSize(.large)
            Text(isConnected ? "正在读取网络状态" : "正在启动保护服务")
                .font(.headline)
            Text("数据仅在本机处理")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct OverviewView: View {
    @ObservedObject var store: DashboardStore
    let status: DNSGuardStatus

    private let columns = [
        GridItem(.adaptive(minimum: 178, maximum: 260), spacing: 14),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(
                    title: "网络概览",
                    subtitle: "更新于 \(Formatters.time(status.generatedAt))"
                )
                AssessmentHero(store: store, status: status)
                LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                    MetricCard(
                        title: "网络",
                        value: status.network.defaultInterface ?? "未连接",
                        detail: status.network.localIp ?? "无本机地址",
                        symbol: "network",
                        state: status.network.defaultInterface == nil ? "fail" : "pass"
                    )
                    MetricCard(
                        title: "Clash",
                        value: status.clash.running ? "运行中" : "未运行",
                        detail: [status.clash.mode, status.clash.version].compactMap { $0 }.joined(separator: " · "),
                        symbol: "point.3.connected.trianglepath.dotted",
                        state: status.clash.running ? "pass" : "fail"
                    )
                    MetricCard(
                        title: "加密上游",
                        value: "\(status.assessment.counts.encrypted) 个",
                        detail: status.assessment.counts.plaintext > 0 ? "发现明文解析" : "未发现明文解析",
                        symbol: "lock.shield",
                        state: status.assessment.counts.plaintext > 0 ? "fail" : "pass"
                    )
                    MetricCard(
                        title: "DNS 路由",
                        value: checkValue("dns-route", in: status),
                        detail: status.network.systemDns.joined(separator: " · ").nonempty ?? "未读取系统 DNS",
                        symbol: "arrow.triangle.branch",
                        state: checkState("dns-route", in: status)
                    )
                    MetricCard(
                        title: "IPv6",
                        value: status.network.ipv6Address == nil ? "未启用" : "已启用",
                        detail: status.network.ipv6Address ?? "无公网 IPv6",
                        symbol: "6.circle",
                        state: status.network.ipv6Address == nil ? "pass" : "warn"
                    )
                    MetricCard(
                        title: "Tailscale",
                        value: tailscaleValue(status.tailscale),
                        detail: status.tailscale.exitNodeActive == true ? "使用出口节点" : "未使用出口节点",
                        symbol: "point.3.filled.connected.trianglepath.dotted",
                        state: status.tailscale.exitNodeActive == true ? "warn" : "pass"
                    )
                }
            }
            .padding(24)
        }
    }

    private func checkValue(_ id: String, in status: DNSGuardStatus) -> String {
        status.assessment.checks.first(where: { $0.id == id })?.value ?? "需检查"
    }

    private func checkState(_ id: String, in status: DNSGuardStatus) -> String {
        status.assessment.checks.first(where: { $0.id == id })?.state ?? "warn"
    }

    private func tailscaleValue(_ snapshot: TailscaleSnapshot) -> String {
        if !snapshot.installed { return "未安装" }
        return snapshot.running ? "运行中" : "未连接"
    }
}

private struct AssessmentHero: View {
    @ObservedObject var store: DashboardStore
    let status: DNSGuardStatus

    var body: some View {
        Surface(padding: 20) {
            HStack(spacing: 18) {
                ZStack {
                    Circle()
                        .fill(StateStyle.color(status.assessment.level).opacity(0.14))
                    Image(systemName: StateStyle.heroSymbol(status.assessment.level))
                        .font(.system(size: 29, weight: .semibold))
                        .foregroundStyle(StateStyle.color(status.assessment.level))
                }
                .frame(width: 64, height: 64)

                VStack(alignment: .leading, spacing: 6) {
                    StatePill(state: status.assessment.level)
                    Text(status.assessment.title)
                        .font(.title2.weight(.semibold))
                    Text(status.assessment.message)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 16)

                VStack(alignment: .trailing, spacing: 7) {
                    Toggle("防泄漏", isOn: Binding(
                        get: { store.protectionIsOn },
                        set: { store.setProtection($0) }
                    ))
                    .toggleStyle(.switch)
                    .font(.headline)
                    .disabled(!store.protectionIsAvailable)
                    Text(protectionDetail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var protectionDetail: String {
        if store.isChangingProtection {
            return store.protectionIsOn ? "正在开启" : "正在恢复"
        }
        if status.protection.enabled {
            return status.protection.effective ? "保护已生效" : "配置需检查"
        }
        return status.protection.available ? "保护已关闭" : "当前不可用"
    }
}

private struct ProtectionView: View {
    @ObservedObject var store: DashboardStore
    let status: DNSGuardStatus

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(title: "防泄漏保护", subtitle: "管理 Mihomo DNS 分流")

                Surface(padding: 20) {
                    HStack(spacing: 16) {
                        Image(systemName: "shield.checkered")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(status.protection.effective ? .green : .secondary)
                            .frame(width: 54, height: 54)
                            .background(.green.opacity(status.protection.effective ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 14))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(status.protection.enabled ? "保护已开启" : "保护已关闭")
                                .font(.title3.weight(.semibold))
                            Text(protectionSummary)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if store.isChangingProtection {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Toggle("", isOn: Binding(
                            get: { store.protectionIsOn },
                            set: { store.setProtection($0) }
                        ))
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .controlSize(.large)
                        .disabled(!store.protectionIsAvailable)
                    }
                }

                HStack(alignment: .top, spacing: 14) {
                    PolicyCard(
                        title: "代理查询",
                        symbol: "globe.americas.fill",
                        endpoints: status.clash.dns.nameserver ?? [],
                        footer: status.clash.dns.respectRules == true ? "跟随路由规则" : "未跟随规则"
                    )
                    PolicyCard(
                        title: "直连查询",
                        symbol: "location.fill",
                        endpoints: status.clash.dns.directNameserver ?? [],
                        footer: "国内域名优先"
                    )
                }

                Surface {
                    VStack(alignment: .leading, spacing: 0) {
                        SettingsRow(label: "TUN 接管", value: status.clash.tun.enable == true ? "已开启" : "未开启", state: status.clash.tun.enable == true ? "pass" : "fail")
                        Divider()
                        SettingsRow(label: "DNS 劫持", value: (status.clash.tun.dnsHijack ?? []).joined(separator: " · ").nonempty ?? "未配置", state: checkState("hijack"))
                        Divider()
                        SettingsRow(label: "严格路由", value: status.clash.tun.strictRoute == true ? "已开启" : "未开启", state: status.clash.tun.strictRoute == true ? "pass" : "warn")
                        Divider()
                        SettingsRow(label: "配置匹配", value: status.protection.profileMatches ? "一致" : "已变化", state: status.protection.profileMatches ? "pass" : "fail")
                    }
                }
            }
            .padding(24)
        }
    }

    private var protectionSummary: String {
        if store.isChangingProtection { return store.protectionIsOn ? "正在写入并校验配置" : "正在恢复原始配置" }
        if !status.protection.available { return "请启动 Clash Verge 与 TUN" }
        if status.protection.enabled { return status.protection.effective ? "分流 DNS 已生效" : "运行配置需检查" }
        return "开启前会备份并校验配置"
    }

    private func checkState(_ id: String) -> String {
        status.assessment.checks.first(where: { $0.id == id })?.state ?? "warn"
    }
}

private struct TestView: View {
    @ObservedObject var store: DashboardStore
    let status: DNSGuardStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center) {
                PageHeader(title: "DNS 检测", subtitle: "验证真实解析出口")
                Spacer()
                Button {
                    store.runTest()
                } label: {
                    Label(store.isTesting ? "检测中" : "开始检测", systemImage: "waveform.path.ecg")
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isBusy)
            }

            if store.isTesting {
                Surface(padding: 18) {
                    HStack(spacing: 13) {
                        ProgressView()
                            .controlSize(.small)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("正在检测 DNS 出口")
                                .font(.headline)
                            Text("通常需要 20 至 30 秒")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
            }

            if let result = store.dnsTest ?? status.dnsTest {
                TestSummary(result: result)
                Surface(padding: 0) {
                    Table(result.resolvers) {
                        TableColumn("DNS 地址", value: \.ip)
                            .width(min: 150, ideal: 190)
                        TableColumn("服务商", value: \.organization)
                            .width(min: 170, ideal: 230)
                        TableColumn("位置") { resolver in
                            Text(Formatters.location(city: resolver.city, country: resolver.country))
                        }
                        .width(min: 160, ideal: 220)
                    }
                    .tableStyle(.inset(alternatesRowBackgrounds: true))
                }
            } else if !store.isTesting {
                Surface {
                    VStack(spacing: 14) {
                        Image(systemName: "waveform.path.ecg.rectangle")
                            .font(.system(size: 38, weight: .regular))
                            .foregroundStyle(.secondary)
                        Text("尚未检测")
                            .font(.title3.weight(.semibold))
                        Text("点击开始检测真实 DNS 出口")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 260)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(24)
    }
}

private struct TestSummary: View {
    let result: DNSTestResult

    var body: some View {
        HStack(spacing: 14) {
            Surface {
                SummaryValue(
                    label: "检测结果",
                    value: verdict,
                    detail: result.partial ? "结果可能不完整" : result.source,
                    state: result.verdict
                )
            }
            Surface {
                SummaryValue(
                    label: "当前出口",
                    value: result.publicExit.ip ?? "未知",
                    detail: Formatters.location(city: result.publicExit.city, country: result.publicExit.country),
                    state: "neutral"
                )
            }
            Surface {
                SummaryValue(
                    label: "解析器",
                    value: "\(result.resolvers.count) 个",
                    detail: "耗时 \(result.latencyMs) ms",
                    state: "neutral"
                )
            }
        }
    }

    private var verdict: String {
        switch result.verdict {
        case "safe": return "未发现泄漏"
        case "leak": return "发现泄漏"
        case "offline": return "服务离线"
        default: return "需要检查"
        }
    }
}

private struct DetailsView: View {
    let status: DNSGuardStatus

    private let columns = [
        GridItem(.adaptive(minimum: 230, maximum: 360), spacing: 14),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(title: "检查明细", subtitle: "\(passedCount)/\(status.assessment.checks.count) 项通过")

                LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                    ForEach(status.assessment.checks) { check in
                        Surface {
                            VStack(alignment: .leading, spacing: 9) {
                                HStack {
                                    Text(check.label)
                                        .font(.headline)
                                    Spacer()
                                    StateDot(state: check.state)
                                }
                                Text(check.value)
                                    .font(.title3.weight(.semibold))
                                Text(check.detail.nonempty ?? "无更多信息")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                                    .help(check.detail)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                Surface(padding: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("DNS 上游")
                            .font(.headline)
                            .padding(16)
                        Divider()
                        ForEach(Array(status.assessment.endpoints.enumerated()), id: \.element.id) { index, endpoint in
                            SettingsRow(
                                label: endpoint.endpoint,
                                value: StateStyle.transportLabel(endpoint.transport),
                                state: StateStyle.transportState(endpoint.transport)
                            )
                            if index < status.assessment.endpoints.count - 1 { Divider() }
                        }
                    }
                }
            }
            .padding(24)
        }
    }

    private var passedCount: Int {
        status.assessment.checks.filter { $0.state == "pass" }.count
    }
}

private struct AboutView: View {
    let status: DNSGuardStatus

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Spacer(minLength: 26)
                Image(nsImage: NSImage(named: NSImage.applicationIconName) ?? NSImage())
                    .resizable()
                    .frame(width: 104, height: 104)
                    .shadow(color: .black.opacity(0.18), radius: 14, y: 7)
                VStack(spacing: 5) {
                    Text("DNS 守卫")
                        .font(.largeTitle.weight(.bold))
                    Text("版本 \(status.app.version)")
                        .foregroundStyle(.secondary)
                }

                Surface {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("原生 macOS 界面", systemImage: "macwindow")
                        Label("服务仅监听 127.0.0.1", systemImage: "lock.shield")
                        Label("访问令牌仅保存在内存", systemImage: "key.horizontal")
                        Label("配置变更前自动备份", systemImage: "arrow.counterclockwise")
                    }
                    .frame(maxWidth: 420, alignment: .leading)
                }
                Text("本工具保护 DNS 解析路径，不等同于 VPN。")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer(minLength: 26)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
        }
    }
}

private struct PageHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.largeTitle.weight(.bold))
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let detail: String
    let symbol: String
    let state: String

    var body: some View {
        Surface {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: symbol)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(StateStyle.color(state))
                        .frame(width: 30, height: 30)
                        .background(StateStyle.color(state).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    Spacer()
                    StateDot(state: state)
                }
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                Text(detail.nonempty ?? "—")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .help(detail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct PolicyCard: View {
    let title: String
    let symbol: String
    let endpoints: [String]
    let footer: String

    var body: some View {
        Surface {
            VStack(alignment: .leading, spacing: 12) {
                Label(title, systemImage: symbol)
                    .font(.headline)
                if endpoints.isEmpty {
                    Text("未读取到上游")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(endpoints, id: \.self) { endpoint in
                        HStack(spacing: 8) {
                            Image(systemName: "lock.fill")
                                .foregroundStyle(.green)
                            Text(endpoint)
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .help(endpoint)
                        }
                    }
                }
                Text(footer)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct SettingsRow: View {
    let label: String
    let value: String
    let state: String

    var body: some View {
        HStack(spacing: 14) {
            Text(label)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(value)
            StateDot(state: state)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }
}

private struct SummaryValue: View {
    let label: String
    let value: String
    let detail: String
    let state: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(state == "neutral" ? .primary : StateStyle.color(state))
                .lineLimit(1)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct StatePill: View {
    let state: String

    var body: some View {
        Text(StateStyle.label(state))
            .font(.caption.weight(.semibold))
            .foregroundStyle(StateStyle.color(state))
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(StateStyle.color(state).opacity(0.11), in: Capsule())
    }
}

private struct StateDot: View {
    let state: String

    var body: some View {
        Circle()
            .fill(StateStyle.color(state))
            .frame(width: 8, height: 8)
            .accessibilityLabel(StateStyle.label(state))
    }
}

private struct Surface<Content: View>: View {
    let padding: CGFloat
    @ViewBuilder let content: Content

    init(padding: CGFloat = 16, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 0.75)
            }
    }
}

private enum StateStyle {
    static func color(_ state: String) -> Color {
        switch state {
        case "safe", "pass": return .green
        case "leak", "fail": return .red
        case "risk", "warn": return .orange
        case "offline": return .gray
        default: return .blue
        }
    }

    static func label(_ state: String) -> String {
        switch state {
        case "safe": return "安全"
        case "leak": return "有风险"
        case "risk": return "需检查"
        case "offline": return "离线"
        case "pass": return "通过"
        case "fail": return "失败"
        case "warn": return "注意"
        default: return "状态"
        }
    }

    static func heroSymbol(_ state: String) -> String {
        switch state {
        case "safe": return "checkmark.shield.fill"
        case "leak": return "exclamationmark.shield.fill"
        case "offline": return "wifi.slash"
        default: return "shield.lefthalf.filled"
        }
    }

    static func transportLabel(_ transport: String) -> String {
        switch transport {
        case "encrypted": return "加密"
        case "plaintext": return "明文"
        case "system": return "系统"
        case "local": return "本地"
        default: return "未知"
        }
    }

    static func transportState(_ transport: String) -> String {
        switch transport {
        case "encrypted", "local": return "pass"
        case "plaintext", "system": return "fail"
        default: return "warn"
        }
    }
}

private enum Formatters {
    static func time(_ isoDate: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoDate) else { return "刚刚" }
        let output = DateFormatter()
        output.locale = Locale(identifier: "zh_CN")
        output.dateFormat = "HH:mm:ss"
        return output.string(from: date)
    }

    static func location(city: String, country: String) -> String {
        [city, country].filter { !$0.isEmpty }.joined(separator: " · ").nonempty ?? "未知"
    }
}

private extension String {
    var nonempty: String? { isEmpty ? nil : self }
}
