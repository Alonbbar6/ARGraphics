import Foundation

/// Build-time settings injected through Config/*.xcconfig into Info.plist.
struct AppConfig {
    let apiBaseURL: URL
    let apiKey: String

    static let current: AppConfig? = AppConfig(bundle: .main)

    init?(bundle: Bundle) {
        guard
            let base = bundle.object(forInfoDictionaryKey: "ARGraphicsAPIBaseURL") as? String,
            let key = bundle.object(forInfoDictionaryKey: "ARGraphicsIOSAPIKey") as? String
        else { return nil }
        self.init(baseURLString: base, apiKey: key)
    }

    init?(baseURLString: String, apiKey: String) {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !trimmedKey.isEmpty,
            let url = URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
            url.host != nil
        else { return nil }
        self.apiBaseURL = url
        self.apiKey = trimmedKey
    }
}
