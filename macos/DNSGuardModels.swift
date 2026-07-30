import Foundation

struct DNSGuardStatus: Decodable {
    let app: AppInfo
    let generatedAt: String
    let network: NetworkSnapshot
    let client: ClientSnapshot
    let clash: ClashSnapshot
    let tailscale: TailscaleSnapshot
    let protection: ProtectionSnapshot
    let assessment: AssessmentSnapshot
    let dnsTest: DNSTestResult?
}

struct ClientSnapshot: Decodable {
    let mode: String
    let primary: NetworkClient
    let clients: [NetworkClient]
}

struct NetworkClient: Decodable, Identifiable {
    let id: String
    let name: String
    let family: String
    let compatibility: String
    let installed: Bool
    let running: Bool
}

struct AppInfo: Decodable {
    let version: String
    let localOnly: Bool
}

struct NetworkSnapshot: Decodable {
    let defaultInterface: String?
    let gateway: String?
    let localIp: String?
    let ipv6Address: String?
    let systemDns: [String]
    let dnsRoutes: [DNSRoute]
}

struct DNSRoute: Decodable, Identifiable {
    let server: String
    let interface: String?

    var id: String { "\(server)-\(`interface` ?? "unknown")" }
}

struct ClashSnapshot: Decodable {
    let running: Bool
    let version: String?
    let mode: String?
    let ipv6: Bool
    let tun: TUNSnapshot
    let dns: DNSSnapshot
    let error: String?
}

struct TUNSnapshot: Decodable {
    let enable: Bool?
    let device: String?
    let strictRoute: Bool?
    let dnsHijack: [String]?
    let ipv6: Bool?

    enum CodingKeys: String, CodingKey {
        case enable
        case device
        case strictRoute = "strict-route"
        case dnsHijack = "dns-hijack"
        case ipv6
    }
}

struct DNSSnapshot: Decodable {
    let enable: Bool?
    let listen: String?
    let enhancedMode: String?
    let respectRules: Bool?
    let defaultNameserver: [String]?
    let nameserver: [String]?
    let directNameserver: [String]?
    let proxyServerNameserver: [String]?

    enum CodingKeys: String, CodingKey {
        case enable
        case listen
        case enhancedMode = "enhanced-mode"
        case respectRules = "respect-rules"
        case defaultNameserver = "default-nameserver"
        case nameserver
        case directNameserver = "direct-nameserver"
        case proxyServerNameserver = "proxy-server-nameserver"
    }
}

struct TailscaleSnapshot: Decodable {
    let installed: Bool
    let running: Bool
    let state: String?
    let exitNodeActive: Bool?
}

struct ProtectionSnapshot: Decodable {
    let enabled: Bool
    let effective: Bool
    let available: Bool
    let busy: Bool
    let phase: String
    let changedAt: String?
    let profileMatches: Bool
}

struct AssessmentSnapshot: Decodable {
    let level: String
    let title: String
    let message: String
    let checks: [AssessmentCheck]
    let endpoints: [DNSEndpoint]
    let counts: EndpointCounts
}

struct AssessmentCheck: Decodable, Identifiable {
    let id: String
    let label: String
    let state: String
    let value: String
    let detail: String
}

struct DNSEndpoint: Decodable, Identifiable {
    let endpoint: String
    let transport: String

    var id: String { endpoint }
}

struct EndpointCounts: Decodable {
    let encrypted: Int
    let plaintext: Int
    let system: Int
    let unknown: Int
}

struct DNSTestResult: Decodable {
    let checkedAt: String
    let latencyMs: Int
    let resolvers: [DNSResolver]
    let publicExit: PublicExit
    let verdict: String
    let leakReason: String?
    let source: String
    let partial: Bool
}

struct DNSResolver: Decodable, Identifiable {
    let ip: String
    let organization: String
    let country: String
    let countryCode: String
    let city: String

    var id: String { "\(ip)-\(organization)" }
}

struct PublicExit: Decodable {
    let ip: String?
    let organization: String
    let country: String
    let countryCode: String
    let city: String
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case overview = "概览"
    case protection = "防护"
    case test = "检测"
    case details = "明细"
    case about = "关于"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .overview: return "gauge.with.dots.needle.33percent"
        case .protection: return "shield.lefthalf.filled"
        case .test: return "waveform.path.ecg.rectangle"
        case .details: return "list.bullet.rectangle"
        case .about: return "info.circle"
        }
    }
}

struct UserAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}
