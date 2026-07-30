import AppKit
import SwiftUI

@MainActor
final class DashboardWindowController: NSWindowController, NSWindowDelegate {
    private let store: DashboardStore

    init(store: DashboardStore) {
        self.store = store

        let rootView = NativeDashboardView(store: store)
        let hostingController = NSHostingController(rootView: rootView)
        let window = NSWindow(contentViewController: hostingController)
        window.title = "DNS 守卫"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.toolbarStyle = .unified
        window.setContentSize(NSSize(width: 1080, height: 720))
        window.minSize = NSSize(width: 900, height: 640)
        window.center()
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("DNSGuardMainWindow")
        window.backgroundColor = .windowBackgroundColor

        super.init(window: window)
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show() {
        NSApp.setActivationPolicy(.regular)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        DispatchQueue.main.async {
            NSApp.setActivationPolicy(.accessory)
        }
    }
}
