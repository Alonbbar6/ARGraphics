import Foundation

enum APIError: LocalizedError, Equatable {
    case notConfigured
    case unauthorized
    case invalidRequest
    case notFound
    /// 410: the offer has ended.
    case gone
    case rateLimited(retryAfter: Int?)
    case serviceUnavailable
    case server(status: Int)
    case offline
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notConfigured, .unauthorized, .serviceUnavailable:
            return "ARGraphics isn't reachable right now. Ask your server what's on tonight."
        case .invalidRequest, .notFound:
            return "That code isn't active anymore. Ask your server for a fresh one."
        case .gone:
            return "This offer has ended."
        case .rateLimited(let seconds):
            if let seconds { return "Too many tries. Give it \(seconds) seconds." }
            return "Too many tries. Give it a moment."
        case .offline:
            return "You're offline. Check your connection and try again."
        case .server, .invalidResponse:
            return "Something went wrong on our side. Try again."
        }
    }
}

/// Whether a claim was new (201) or the guest's existing claim for today (200).
struct ClaimOutcome: Equatable {
    let claim: Claim
    let isNew: Bool
}

/// The public surface the visitor app needs (the `ios` tag in openapi.yaml).
protocol VisitorAPI: Sendable {
    func scan(code: String, visitorId: String) async throws -> ScanResult
    func venue(slug: String) async throws -> PublicVenue
    func claim(displayId: String, visitorId: String, code: String?) async throws -> ClaimOutcome
    func nearby(slug: String) async throws -> [NearbySpot]
    func artist(slug: String) async throws -> PublicArtist
}

struct APIClient: VisitorAPI {
    let config: AppConfig
    let session: URLSession

    init(config: AppConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    func scan(code: String, visitorId: String) async throws -> ScanResult {
        guard ScanLink.isValidCode(code), VisitorIdentity.isValid(visitorId) else { throw APIError.invalidRequest }
        let body = try JSONEncoder.api.encode(ScanInput(code: code, visitorId: visitorId))
        return try await send(path: ["v1", "scans"], method: "POST", body: body).value
    }

    func venue(slug: String) async throws -> PublicVenue {
        guard ScanLink.isValidSlug(slug) else { throw APIError.notFound }
        return try await send(path: ["v1", "venues", slug]).value
    }

    func claim(displayId: String, visitorId: String, code: String?) async throws -> ClaimOutcome {
        guard Self.isSafeIdentifier(displayId), VisitorIdentity.isValid(visitorId) else { throw APIError.invalidRequest }
        let input = ClaimInput(visitorId: visitorId, code: code.flatMap { ScanLink.isValidCode($0) ? $0 : nil })
        let body = try JSONEncoder.api.encode(input)
        let response: (value: Claim, status: Int) = try await send(
            path: ["v1", "displays", displayId, "claims"], method: "POST", body: body
        )
        return ClaimOutcome(claim: response.value, isNew: response.status == 201)
    }

    func nearby(slug: String) async throws -> [NearbySpot] {
        guard ScanLink.isValidSlug(slug) else { throw APIError.notFound }
        return try await send(path: ["v1", "venues", slug, "nearby"]).value
    }

    func artist(slug: String) async throws -> PublicArtist {
        guard ScanLink.isValidSlug(slug) else { throw APIError.notFound }
        return try await send(path: ["v1", "artists", slug]).value
    }

    /// IDs go into the URL path, so anything that could add a segment or a query is refused.
    static func isSafeIdentifier(_ value: String) -> Bool {
        (1...128).contains(value.count) && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }

    func makeRequest(path: [String], method: String = "GET", body: Data? = nil) -> URLRequest {
        var url = config.apiBaseURL
        for segment in path { url.append(path: segment) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue(config.apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send<T: Decodable>(path: [String], method: String = "GET", body: Data? = nil) async throws -> (value: T, status: Int) {
        let request = makeRequest(path: path, method: method, body: body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError
            where [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost, .dataNotAllowed]
            .contains(error.code) {
            throw APIError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        switch http.statusCode {
        case 200..<300:
            do { return (try JSONDecoder.api.decode(T.self, from: data), http.statusCode) }
            catch { throw APIError.invalidResponse }
        case 400: throw APIError.invalidRequest
        case 401, 403: throw APIError.unauthorized
        case 404: throw APIError.notFound
        case 410: throw APIError.gone
        case 429: throw APIError.rateLimited(retryAfter: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init))
        case 503: throw APIError.serviceUnavailable
        default: throw APIError.server(status: http.statusCode)
        }
    }
}
