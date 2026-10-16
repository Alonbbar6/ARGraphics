import Foundation
import Testing
@testable import ARGraphics

actor FakeVisitorAPI: VisitorAPI {
    var scanError: APIError?
    var claimError: APIError?
    private(set) var calls: [String] = []

    func set(scanError: APIError? = nil, claimError: APIError? = nil) {
        self.scanError = scanError
        self.claimError = claimError
    }

    func scan(code: String, visitorId: String) async throws -> ScanResult {
        calls.append("scan:\(code):\(visitorId)")
        if let scanError { throw scanError }
        return try JSONDecoder.api.decode(ScanResult.self, from: Data(Fixtures.scanResult.utf8))
    }

    func venue(slug: String) async throws -> PublicVenue {
        calls.append("venue:\(slug)")
        return try JSONDecoder.api.decode(PublicVenue.self, from: Data(Fixtures.publicVenue.utf8))
    }

    func claim(displayId: String, visitorId: String, code: String?) async throws -> ClaimOutcome {
        calls.append("claim:\(displayId):\(code ?? "-")")
        if let claimError { throw claimError }
        return ClaimOutcome(claim: try JSONDecoder.api.decode(Claim.self, from: Data(Fixtures.claim.utf8)), isNew: true)
    }

    func nearby(slug: String) async throws -> [NearbySpot] { [] }
    func artist(slug: String) async throws -> PublicArtist { throw APIError.notFound }
}

@MainActor
struct VisitFlowTests {
    let identity = VisitorIdentity(primary: MemoryStore(visitorId), fallback: MemoryStore())

    @Test func codeResolvesThroughScan() async throws {
        let api = FakeVisitorAPI()
        let visit = try await VisitResolver(api: api, identity: identity).resolve(.code("k7m2qx9a"))
        #expect(visit.display?.id == "dsp_offer1")
        #expect(visit.spot?.label == "Table 6")
        #expect(visit.code == "k7m2qx9a")
        #expect(await api.calls == ["scan:k7m2qx9a:\(visitorId)"])
    }

    @Test func venueLinkResolvesWithoutScan() async throws {
        let api = FakeVisitorAPI()
        let visit = try await VisitResolver(api: api, identity: identity).resolve(.venue(slug: "casa-marisol"))
        #expect(visit.display == nil)
        #expect(visit.code == nil)
        #expect(await api.calls == ["venue:casa-marisol"])
    }

    @Test func typedCodeFallsBackToVenue() async throws {
        let api = FakeVisitorAPI()
        await api.set(scanError: .notFound)
        let visit = try await VisitResolver(api: api, identity: identity).resolve(.typed("casamarisol"))
        #expect(visit.venue.slug == "casa-marisol")
        #expect(await api.calls == ["scan:casamarisol:\(visitorId)", "venue:casamarisol"])
    }

    @Test func retiredCodeMessage() {
        let message = VisitResolver.message(for: APIError.notFound, link: .code("k7m2qx9a"))
        #expect(message.contains("isn't active"))
        #expect(VisitResolver.message(for: APIError.rateLimited(retryAfter: 5), link: .code("k7m2qx9a")).contains("5 seconds"))
    }

    @Test func openPublishesStates() async throws {
        let api = FakeVisitorAPI()
        let resolver = VisitResolver(api: api, identity: identity)
        await withCheckedContinuation { continuation in
            resolver.open(.code("k7m2qx9a")) { _ in continuation.resume() }
            #expect(resolver.state == .resolving)
        }
        guard case .resolved(let visit) = resolver.state else { Issue.record("not resolved"); return }
        #expect(visit.venue.name == "Casa Marisol")
    }

    // MARK: Experience

    private func visit() throws -> Visit {
        Visit(scan: try JSONDecoder.api.decode(ScanResult.self, from: Data(Fixtures.scanResult.utf8)), code: "k7m2qx9a")
    }

    @Test func contentAndCardPerDisplayType() throws {
        let visit = try visit()
        let byType = Dictionary(uniqueKeysWithValues: visit.displays.map { ($0.type, $0) })

        let offer = ExperienceModel(visit: visit, display: byType[.promoOffer]!, cameraStatus: .authorized, arSupported: true)
        #expect(offer.content == .none)
        #expect(offer.mode == .flat(.noMedia))
        if case .offer = offer.card {} else { Issue.record("expected offer card") }

        let art = ExperienceModel(visit: visit, display: byType[.artPiece]!, cameraStatus: .authorized, arSupported: true)
        #expect(art.mode == .ar)
        if case .panel(_, let framed) = art.content { #expect(framed) } else { Issue.record("expected panel") }
        if case .artist(let credit) = art.card { #expect(credit.slug == "ana-ruiz") } else { Issue.record("expected artist") }
        #expect(art.tableCards.isEmpty, "wall pieces don't use table cards")

        let menu = ExperienceModel(visit: visit, display: byType[.menuItem]!, cameraStatus: .authorized, arSupported: true)
        if case .model(let url) = menu.content { #expect(url.lastPathComponent == "m.usdz") } else { Issue.record("expected model") }
        #expect(menu.card == .info)
        #expect(menu.tableCards.count == 1)
    }

    @Test func cameraDeniedAndNoARFallBackToPage() throws {
        let visit = try visit()
        let menu = visit.displays.first { $0.type == .menuItem }!
        #expect(ExperienceModel(visit: visit, display: menu, cameraStatus: .denied, arSupported: true).mode == .flat(.cameraOff))
        #expect(ExperienceModel(visit: visit, display: menu, cameraStatus: .authorized, arSupported: false).mode == .flat(.arUnsupported))
    }

    @Test func claimStates() async throws {
        let visit = try visit()
        let api = FakeVisitorAPI()
        let model = ExperienceModel(visit: visit, display: visit.display!, cameraStatus: .authorized, arSupported: true)

        await model.claim(api: api, visitorId: visitorId)
        guard case .claimed(let claim) = model.claimState else { Issue.record("not claimed"); return }
        #expect(claim.confirmationCode == "BX-4821")
        #expect(await api.calls == ["claim:dsp_offer1:k7m2qx9a"])

        await api.set(claimError: .gone)
        await model.claim(api: api, visitorId: visitorId)
        #expect(model.claimState == .ended)

        await api.set(claimError: .notFound)
        await model.claim(api: api, visitorId: visitorId)
        if case .failed = model.claimState {} else { Issue.record("expected failure") }
    }
}
