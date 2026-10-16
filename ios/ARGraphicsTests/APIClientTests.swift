import Foundation
import Testing
@testable import ARGraphics

/// Serves canned responses so the client is tested without a server.
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, [String: String], Data))?
    nonisolated(unsafe) static var lastRequest: URLRequest?
    nonisolated(unsafe) static var lastBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        Self.lastBody = request.httpBody ?? request.httpBodyStream.map(Self.read)
        guard let handler = Self.handler, let url = request.url else { return }
        let (status, headers, body) = handler(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    /// URLSession hands bodies to protocols as streams.
    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

let visitorId = "0f8fad5b-d9cb-469f-a165-70867728950e"

@Suite(.serialized)
struct APIClientTests {
    let client: APIClient

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        client = APIClient(
            config: AppConfig(baseURLString: "https://h.example/api", apiKey: "secret-key")!,
            session: URLSession(configuration: configuration)
        )
        StubURLProtocol.lastRequest = nil
        StubURLProtocol.lastBody = nil
    }

    private func respond(_ status: Int, _ json: String, headers: [String: String] = [:]) {
        StubURLProtocol.handler = { _ in (status, headers, Data(json.utf8)) }
    }

    private func lastJSON() throws -> [String: String]? {
        let body = try #require(StubURLProtocol.lastBody)
        return try JSONSerialization.jsonObject(with: body) as? [String: String]
    }

    @Test func scanPostsCodeAndVisitor() async throws {
        respond(200, Fixtures.scanResult)
        let result = try await client.scan(code: "k7m2qx9a", visitorId: visitorId)
        #expect(result.venue.name == "Casa Marisol")

        let request = try #require(StubURLProtocol.lastRequest)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://h.example/api/v1/scans")
        #expect(request.value(forHTTPHeaderField: "x-api-key") == "secret-key")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(try lastJSON() == ["code": "k7m2qx9a", "visitorId": visitorId])
    }

    @Test func scanRefusesMalformedInputWithoutCallingServer() async {
        respond(200, Fixtures.scanResult)
        await #expect(throws: APIError.invalidRequest) { try await client.scan(code: "../x", visitorId: visitorId) }
        await #expect(throws: APIError.invalidRequest) { try await client.scan(code: "k7m2qx9a", visitorId: "short") }
        #expect(StubURLProtocol.lastRequest == nil)
    }

    @Test func venueGet() async throws {
        respond(200, Fixtures.publicVenue)
        let venue = try await client.venue(slug: "casa-marisol")
        #expect(venue.displays.count == 1)
        let request = try #require(StubURLProtocol.lastRequest)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://h.example/api/v1/venues/casa-marisol")
        #expect(request.value(forHTTPHeaderField: "x-api-key") == "secret-key")
        #expect(request.httpBody == nil)
    }

    @Test func nearbyAndArtistPaths() async throws {
        respond(200, Fixtures.nearby)
        let spots = try await client.nearby(slug: "casa-marisol")
        #expect(spots.count == 2)
        #expect(StubURLProtocol.lastRequest?.url?.path == "/api/v1/venues/casa-marisol/nearby")

        respond(200, Fixtures.artist)
        let artist = try await client.artist(slug: "ana-ruiz")
        #expect(artist.name == "Ana Ruiz")
        #expect(StubURLProtocol.lastRequest?.url?.path == "/api/v1/artists/ana-ruiz")
        #expect(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "x-api-key") == "secret-key")
    }

    @Test func claimNewAndRepeat() async throws {
        respond(201, Fixtures.claim)
        let fresh = try await client.claim(displayId: "dsp_offer1", visitorId: visitorId, code: "k7m2qx9a")
        #expect(fresh.isNew)
        #expect(fresh.claim.confirmationCode == "BX-4821")
        let request = try #require(StubURLProtocol.lastRequest)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/v1/displays/dsp_offer1/claims")
        #expect(try lastJSON() == ["visitorId": visitorId, "code": "k7m2qx9a"])

        respond(200, Fixtures.claim)
        let again = try await client.claim(displayId: "dsp_offer1", visitorId: visitorId, code: nil)
        #expect(!again.isNew)
        #expect(again.claim == fresh.claim)
        #expect(try lastJSON() == ["visitorId": visitorId])
    }

    @Test func claimRefusesPathInjection() async {
        respond(201, Fixtures.claim)
        await #expect(throws: APIError.invalidRequest) {
            try await client.claim(displayId: "../../admin", visitorId: visitorId, code: nil)
        }
        await #expect(throws: APIError.invalidRequest) {
            try await client.claim(displayId: "a?b=c", visitorId: visitorId, code: nil)
        }
        #expect(StubURLProtocol.lastRequest == nil)
    }

    @Test func mapsStatusCodes() async {
        let cases: [(Int, [String: String], APIError)] = [
            (400, [:], .invalidRequest),
            (401, [:], .unauthorized),
            (404, [:], .notFound),
            (410, [:], .gone),
            (429, ["Retry-After": "12"], .rateLimited(retryAfter: 12)),
            (429, [:], .rateLimited(retryAfter: nil)),
            (503, [:], .serviceUnavailable),
            (500, [:], .server(status: 500)),
        ]
        for (status, headers, expected) in cases {
            respond(status, #"{"error":"x"}"#, headers: headers)
            await #expect(throws: expected) {
                try await client.claim(displayId: "dsp_offer1", visitorId: visitorId, code: nil)
            }
        }
    }

    @Test func scanNotFoundAndVenueNotFound() async {
        respond(404, #"{"error":"Unknown code"}"#)
        await #expect(throws: APIError.notFound) { try await client.scan(code: "k7m2qx9a", visitorId: visitorId) }
        await #expect(throws: APIError.notFound) { try await client.venue(slug: "nope") }
        await #expect(throws: APIError.notFound) { try await client.venue(slug: "Not A Slug") }
    }

    @Test func rejectsMalformedBody() async {
        respond(200, "{}")
        await #expect(throws: APIError.invalidResponse) { try await client.venue(slug: "casa") }
    }

    @Test func configRequiresKeyAndHTTPURL() {
        #expect(AppConfig(baseURLString: "https://h.example/api", apiKey: "  ") == nil)
        #expect(AppConfig(baseURLString: "file:///etc", apiKey: "k") == nil)
        #expect(AppConfig(baseURLString: "not a url", apiKey: "k") == nil)
    }
}
