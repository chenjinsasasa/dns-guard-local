import Foundation

struct DNSGuardAPI {
    let baseURL: URL
    let token: String

    func status() async throws -> DNSGuardStatus {
        try await request(path: "/api/status", method: "GET", body: Optional<EmptyBody>.none)
    }

    func runTest() async throws -> DNSTestResult {
        try await request(path: "/api/dns-test", method: "POST", body: EmptyBody())
    }

    func setProtection(enabled: Bool) async throws -> DNSGuardStatus {
        try await request(
            path: "/api/protection",
            method: "POST",
            body: ProtectionRequest(enabled: enabled)
        )
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw DNSGuardAPIError(message: "本地服务地址无效")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = path == "/api/dns-test" ? 45 : 30
        request.setValue(token, forHTTPHeaderField: "x-dns-guard-token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw DNSGuardAPIError(message: "无法连接本地服务：\(error.localizedDescription)")
        }

        guard let http = response as? HTTPURLResponse else {
            throw DNSGuardAPIError(message: "本地服务响应无效")
        }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
            throw DNSGuardAPIError(message: payload?.message ?? "请求失败（\(http.statusCode)）")
        }

        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw DNSGuardAPIError(message: "无法读取本地服务数据")
        }
    }
}

private struct EmptyBody: Encodable {}

private struct ProtectionRequest: Encodable {
    let enabled: Bool
}

private struct APIErrorPayload: Decodable {
    let message: String
}

struct DNSGuardAPIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
