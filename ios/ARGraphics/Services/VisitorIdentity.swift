import Foundation
import Security

/// Somewhere to keep one small string across launches.
protocol ValueStore {
    func read() -> String?
    /// Returns false when the value couldn't be saved.
    @discardableResult func write(_ value: String) -> Bool
}

/// An anonymous, random ID for this install. It lets the server count unique guests and
/// keep claims to one per guest per offer per day. It is never tied to a name or account.
///
/// Kept in the Keychain (survives reinstalls on the same device), falling back to
/// UserDefaults when the Keychain is unavailable.
final class VisitorIdentity: @unchecked Sendable {
    static let shared = VisitorIdentity(primary: KeychainValueStore(), fallback: DefaultsValueStore())

    private let primary: ValueStore
    private let fallback: ValueStore
    private let lock = NSLock()
    private var cached: String?

    init(primary: ValueStore, fallback: ValueStore) {
        self.primary = primary
        self.fallback = fallback
    }

    /// Matches `visitorId` in ScanInput and ClaimInput.
    static func isValid(_ value: String) -> Bool {
        (16...64).contains(value.count) && value.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil
    }

    var id: String {
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }
        let value = load()
        cached = value
        return value
    }

    private func load() -> String {
        if let stored = primary.read(), Self.isValid(stored) { return stored }
        if let stored = fallback.read(), Self.isValid(stored) {
            // Move an ID saved while the Keychain was unavailable into it.
            primary.write(stored)
            return stored
        }
        let fresh = UUID().uuidString.lowercased()
        if !primary.write(fresh) { fallback.write(fresh) }
        return fresh
    }
}

struct KeychainValueStore: ValueStore {
    var service = "app.argraphics.visitor"
    var account = "visitorId"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func write(_ value: String) -> Bool {
        let data = Data(value.utf8)
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}

struct DefaultsValueStore: ValueStore {
    var defaults: UserDefaults = .standard
    var key = "app.argraphics.visitorId"

    func read() -> String? { defaults.string(forKey: key) }

    @discardableResult
    func write(_ value: String) -> Bool {
        defaults.set(value, forKey: key)
        return true
    }
}
