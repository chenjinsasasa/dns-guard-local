import AppKit

@main
enum DNSGuardMain {
    @MainActor
    static func main() {
        let application = NSApplication.shared
        let appDelegate = AppDelegate()
        application.setActivationPolicy(.accessory)
        application.delegate = appDelegate
        application.run()
    }
}
