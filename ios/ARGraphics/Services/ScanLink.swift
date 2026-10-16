import Foundation

/// What a scanned QR code (or an opened link) points at.
///
/// Accepted payloads. Only the code or slug is used: the link's host is never trusted,
/// so a QR code cannot point the app at another server. Requests always go to the
/// configured API.
/// - `https://<any-host>/s/{code}` (what printed QR codes encode; `{code}` is 6–16 of `a-z0-9`)
/// - `argraphics://s/{code}`
/// - `argraphics://venue/{slug}` and legacy web links `https://<any-host>/b|bars|venues/{slug}`
/// - a bare venue slug such as `casa-marisol`
enum ScanLink: Hashable {
    /// A placed QR code: resolved with `POST /v1/scans`.
    case code(String)
    /// A venue without a specific spot: resolved with `GET /v1/venues/{slug}`.
    case venue(slug: String)
    /// Typed by hand under the QR. Could be either a code or a slug, so the resolver tries both.
    case typed(String)

    static let scheme = "argraphics"

    static func parse(_ raw: String) -> ScanLink? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 2048 else { return nil }

        if !text.contains(":"), !text.contains("/") {
            let slug = text.lowercased()
            return isValidSlug(slug) ? .venue(slug: slug) : nil
        }

        guard let components = URLComponents(string: text), let scheme = components.scheme?.lowercased() else {
            return nil
        }
        // A user/password in the URL is a classic spoofing trick; such links aren't ours.
        guard components.user == nil, components.password == nil else { return nil }

        switch scheme {
        case Self.scheme:
            let host = components.host?.lowercased()
            let segments = pathSegments(components.path)
            guard segments.count == 1 else { return nil }
            switch host {
            case "s": return makeCode(segments[0])
            case "venue": return makeVenue(segments[0])
            default: return nil
            }
        case "https", "http":
            guard components.host?.isEmpty == false else { return nil }
            let segments = pathSegments(components.path)
            guard segments.count >= 2 else { return nil }
            let marker = segments[segments.count - 2].lowercased()
            let value = segments[segments.count - 1]
            switch marker {
            case "s": return makeCode(value)
            case "b", "bars", "venues", "venue": return makeVenue(value)
            default: return nil
            }
        default:
            return nil
        }
    }

    /// Manual entry: whatever the guest typed under the QR.
    static func parseTyped(_ raw: String) -> ScanLink? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if isValidCode(text) { return .typed(text) }
        if isValidSlug(text) { return .venue(slug: text) }
        return parse(raw)
    }

    static func isValidCode(_ value: String) -> Bool {
        (6...16).contains(value.count) && value.range(of: "^[a-z0-9]+$", options: .regularExpression) != nil
    }

    static func isValidSlug(_ value: String) -> Bool {
        guard (1...120).contains(value.count) else { return false }
        return value.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil
    }

    /// QR codes often upper-case URLs to fit alphanumeric mode, so codes are case-folded.
    private static func makeCode(_ raw: String) -> ScanLink? {
        let code = raw.lowercased()
        return isValidCode(code) ? ScanLink.code(code) : nil
    }

    private static func makeVenue(_ raw: String) -> ScanLink? {
        let slug = raw.lowercased()
        return isValidSlug(slug) ? ScanLink.venue(slug: slug) : nil
    }

    private static func pathSegments(_ path: String) -> [String] {
        path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    }
}
