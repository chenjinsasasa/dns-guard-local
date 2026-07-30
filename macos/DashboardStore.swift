import Combine
import Foundation

@MainActor
final class DashboardStore: ObservableObject {
    @Published var selection: SidebarSection = .overview
    @Published private(set) var status: DNSGuardStatus?
    @Published private(set) var dnsTest: DNSTestResult?
    @Published private(set) var isConnected = false
    @Published private(set) var isRefreshing = false
    @Published private(set) var isTesting = false
    @Published private(set) var isChangingProtection = false
    @Published private(set) var requestedProtectionState: Bool?
    @Published var alert: UserAlert?

    private var api: DNSGuardAPI?
    private var refreshTimer: Timer?

    var protectionIsOn: Bool {
        requestedProtectionState ?? status?.protection.enabled ?? false
    }

    var protectionIsAvailable: Bool {
        guard let protection = status?.protection else { return false }
        return protection.available && !protection.busy && !isChangingProtection
    }

    var isBusy: Bool {
        isRefreshing || isTesting || isChangingProtection
    }

    func connect(baseURL: URL, token: String) {
        api = DNSGuardAPI(baseURL: baseURL, token: token)
        isConnected = true
        startRefreshTimer()
        refresh()
    }

    func markServerRestarting() {
        api = nil
        isConnected = false
        status = nil
        dnsTest = nil
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func refresh(quiet: Bool = false) {
        guard let api, !isRefreshing, !isChangingProtection else { return }
        isRefreshing = true
        Task {
            defer { isRefreshing = false }
            do {
                let snapshot = try await api.status()
                status = snapshot
                if let result = snapshot.dnsTest { dnsTest = result }
            } catch {
                if !quiet { showError(error) }
            }
        }
    }

    func runTest(quiet: Bool = false) {
        guard let api, !isTesting, !isChangingProtection else { return }
        isTesting = true
        Task {
            defer { isTesting = false }
            do {
                dnsTest = try await api.runTest()
                let snapshot = try await api.status()
                status = snapshot
            } catch {
                if !quiet { showError(error) }
            }
        }
    }

    func setProtection(_ enabled: Bool) {
        guard let api, protectionIsAvailable else { return }
        requestedProtectionState = enabled
        isChangingProtection = true
        Task {
            defer {
                requestedProtectionState = nil
                isChangingProtection = false
            }
            do {
                let snapshot = try await api.setProtection(enabled: enabled)
                status = snapshot
                dnsTest = snapshot.dnsTest
                if enabled {
                    isTesting = true
                    do {
                        dnsTest = try await api.runTest()
                        status = try await api.status()
                    } catch {
                        showError(error, title: "保护已开启，复测失败")
                    }
                    isTesting = false
                }
            } catch {
                showError(error)
                do {
                    status = try await api.status()
                } catch {
                    // Keep the last confirmed state visible.
                }
            }
        }
    }

    private func startRefreshTimer() {
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            guard let store = self else { return }
            Task { @MainActor in
                guard !store.isBusy else { return }
                store.refresh(quiet: true)
            }
        }
    }

    private func showError(_ error: Error, title: String = "操作失败") {
        alert = UserAlert(title: title, message: error.localizedDescription)
    }
}
