import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var statusMenuItem: NSMenuItem!
    private var openMenuItem: NSMenuItem!
    private var serverProcess: Process?
    private var outputPipe: Pipe?
    private var outputBuffer = ""
    private var panelURL: URL?
    private var openedAutomatically = false
    private var isQuitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenu()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        isQuitting = true
        stopServer()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openPanel()
        return false
    }

    private func configureMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "shield.lefthalf.filled",
            accessibilityDescription: "DNS 守卫"
        )
        statusItem.button?.toolTip = "DNS 守卫"

        let menu = NSMenu()
        statusMenuItem = NSMenuItem(title: "正在启动", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())

        openMenuItem = NSMenuItem(title: "打开面板", action: #selector(openPanel), keyEquivalent: "o")
        openMenuItem.target = self
        openMenuItem.isEnabled = false
        menu.addItem(openMenuItem)

        let restartItem = NSMenuItem(title: "重新启动", action: #selector(restartServer), keyEquivalent: "r")
        restartItem.target = self
        menu.addItem(restartItem)
        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "退出", action: #selector(quitApplication), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        statusItem.menu = menu
    }

    private func findNode() -> String? {
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/opt/homebrew/opt/node/bin/node",
            "/usr/local/opt/node/bin/node",
        ]
        return candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) })
    }

    private func startServer() {
        guard serverProcess == nil else { return }
        guard let nodePath = findNode() else {
            showFailure("未找到 Node.js 22 或更高版本。请先运行 brew install node。")
            return
        }
        guard let resources = Bundle.main.resourceURL else {
            showFailure("应用资源不完整，请重新安装。")
            return
        }

        let serverDirectory = resources.appendingPathComponent("dns-guard", isDirectory: true)
        let serverFile = serverDirectory.appendingPathComponent("server.mjs")
        guard FileManager.default.fileExists(atPath: serverFile.path) else {
            showFailure("未找到本地服务文件，请重新安装。")
            return
        }

        let dataDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/DNS Guard", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: dataDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            showFailure("无法创建运行数据目录：\(error.localizedDescription)")
            return
        }

        outputBuffer = ""
        panelURL = nil
        openedAutomatically = false
        statusMenuItem.title = "正在启动"
        openMenuItem.isEnabled = false

        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [serverFile.path]
        process.currentDirectoryURL = serverDirectory

        var environment = ProcessInfo.processInfo.environment
        let extraPath = "/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin:/usr/local/opt/node/bin"
        environment["PATH"] = extraPath + ":" + (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")
        environment["DNS_GUARD_NO_OPEN"] = "1"
        environment["DNS_GUARD_DATA_DIR"] = dataDirectory.path
        environment["DNS_GUARD_PORT"] = "41731"
        process.environment = environment
        process.standardOutput = pipe
        process.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.consumeOutput(text)
            }
        }
        process.terminationHandler = { [weak self] terminated in
            DispatchQueue.main.async {
                self?.serverDidTerminate(code: terminated.terminationStatus)
            }
        }

        do {
            try process.run()
            serverProcess = process
            outputPipe = pipe
        } catch {
            pipe.fileHandleForReading.readabilityHandler = nil
            showFailure("本地服务启动失败：\(error.localizedDescription)")
        }
    }

    private func consumeOutput(_ text: String) {
        outputBuffer += text
        let pattern = #"http://127\.0\.0\.1:[0-9]+/\?token=[0-9a-f]+"#
        guard panelURL == nil,
              let range = outputBuffer.range(of: pattern, options: .regularExpression),
              let url = URL(string: String(outputBuffer[range])) else { return }

        panelURL = url
        statusMenuItem.title = "保护服务运行中"
        openMenuItem.isEnabled = true
        if !openedAutomatically {
            openedAutomatically = true
            NSWorkspace.shared.open(url)
        }
    }

    private func serverDidTerminate(code: Int32) {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        outputPipe = nil
        serverProcess = nil
        panelURL = nil
        openMenuItem.isEnabled = false
        if isQuitting { return }

        statusMenuItem.title = "服务已停止"
        let detail = outputBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
        showFailure(detail.isEmpty ? "本地服务意外停止（\(code)）。" : detail)
    }

    private func stopServer() {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        guard let process = serverProcess, process.isRunning else {
            serverProcess = nil
            return
        }
        process.terminate()
        process.waitUntilExit()
        serverProcess = nil
        outputPipe = nil
    }

    private func showFailure(_ message: String) {
        statusMenuItem.title = "启动失败"
        openMenuItem.isEnabled = false
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "DNS 守卫无法启动"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    @objc private func openPanel() {
        guard let panelURL else { return }
        NSWorkspace.shared.open(panelURL)
    }

    @objc private func restartServer() {
        statusMenuItem.title = "正在重启"
        stopServer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.startServer()
        }
    }

    @objc private func quitApplication() {
        isQuitting = true
        stopServer()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.setActivationPolicy(.accessory)
application.delegate = appDelegate
application.run()
