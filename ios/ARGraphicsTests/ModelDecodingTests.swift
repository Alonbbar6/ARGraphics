import Foundation
import Testing
@testable import ARGraphics

struct ModelDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder.api.decode(T.self, from: Data(json.utf8))
    }

    @Test func scanResult() throws {
        let result = try decode(ScanResult.self, Fixtures.scanResult)
        #expect(result.venue.name == "Casa Marisol")
        #expect(result.venue.kind == .venue)
        #expect(result.spot == PublicSpot(label: "Table 6", placement: .table))
        #expect(result.display?.id == "dsp_offer1")
        #expect(result.displays.map(\.type) == [.promoOffer, .artPiece, .menuItem, .eventTeaser])
        #expect(result.tableCards.first?.physicalWidthCm == 10.5)

        let offer = try #require(result.display?.offer)
        #expect(offer.endsAt == APIDate.parse("2026-10-15T03:00:00Z"))
        #expect(result.display?.mediaURL == nil)
        #expect(result.display?.artist == nil)
    }

    @Test func scanResultWithNullDisplay() throws {
        let result = try decode(ScanResult.self, Fixtures.scanResultNoDisplay)
        #expect(result.display == nil)
        #expect(result.spot.placement == .window)
        #expect(result.tableCards.isEmpty)
    }

    @Test func displayVariants() throws {
        let art = try decode(PublicDisplay.self, Fixtures.artDisplay)
        #expect(art.placement == .wall)
        #expect(art.artist == PublicArtistCredit(name: "Ana Ruiz", slug: "ana-ruiz", bio: nil))
        #expect(art.mediaURL?.lastPathComponent == "bloom.webp")

        let menu = try decode(PublicDisplay.self, Fixtures.menuDisplay)
        #expect(menu.price == "$14.00")
        #expect(menu.modelURL?.lastPathComponent == "m.usdz")

        let event = try decode(PublicDisplay.self, Fixtures.eventDisplay)
        #expect(event.eventStartsAt == APIDate.parse("2026-10-17T01:00:00.000Z"))
        #expect(event.placement == .poster)
    }

    @Test func unknownEnumValuesDoNotBreakDecoding() throws {
        let json = Fixtures.offerDisplay
            .replacingOccurrences(of: "\"promo_offer\"", with: "\"hologram\"")
            .replacingOccurrences(of: "\"table\"", with: "\"ceiling\"")
        let display = try decode(PublicDisplay.self, json)
        #expect(display.type == .unknown)
        #expect(display.placement == .unknown)
        let venue = try decode(PublicVenueSummary.self, Fixtures.venueSummary.replacingOccurrences(of: "\"venue\"", with: "\"gallery\""))
        #expect(venue.kind == .unknown)
    }

    @Test func publicVenue() throws {
        let venue = try decode(PublicVenue.self, Fixtures.publicVenue)
        #expect(venue.venue.slug == "casa-marisol")
        #expect(venue.displays.count == 1)
        #expect(venue.tableCards.count == 1)
    }

    @Test func claims() throws {
        let claim = try decode(Claim.self, Fixtures.claim)
        #expect(claim.confirmationCode == "BX-4821")
        #expect(claim.spotLabel == "Table 6")
        #expect(claim.expiresAt.timeIntervalSince(claim.claimedAt) == 15 * 60)

        let noSpot = try decode(Claim.self, Fixtures.claimNoSpot)
        #expect(noSpot.spotLabel == nil)
    }

    @Test func nearbyAndArtist() throws {
        let spots = try decode([NearbySpot].self, Fixtures.nearby)
        #expect(spots.map(\.slug) == ["la-gaviota", "ana-ruiz"])
        #expect(spots[0].featured == "3D special")
        #expect(spots[1].featured == nil)
        #expect(spots[1].kind == .artist)

        let artist = try decode(PublicArtist.self, Fixtures.artist)
        #expect(artist.pieces.first?.venueSlug == "casa-marisol")
        #expect(artist.pieces.first?.mediaURL == nil)
    }

    @Test func missingRequiredFieldFails() {
        let json = Fixtures.claim.replacingOccurrences(of: "\"confirmationCode\":\"BX-4821\",", with: "")
        #expect(throws: DecodingError.self) { try decode(Claim.self, json) }
    }

    @Test func badDateFails() {
        let json = Fixtures.claim.replacingOccurrences(of: "2026-10-15T00:14:00.000Z", with: "yesterday")
        #expect(throws: DecodingError.self) { try decode(Claim.self, json) }
    }

    @Test func inputsEncodeExactlyTheContractFields() throws {
        let scan = try JSONSerialization.jsonObject(with: JSONEncoder.api.encode(
            ScanInput(code: "k7m2qx9a", visitorId: "0f8fad5b-d9cb-469f-a165-70867728950e"))) as? [String: String]
        #expect(scan == ["code": "k7m2qx9a", "visitorId": "0f8fad5b-d9cb-469f-a165-70867728950e"])

        let claim = try JSONSerialization.jsonObject(with: JSONEncoder.api.encode(
            ClaimInput(visitorId: "0f8fad5b-d9cb-469f-a165-70867728950e", code: nil))) as? [String: String]
        #expect(claim == ["visitorId": "0f8fad5b-d9cb-469f-a165-70867728950e"])
    }

    @Test func mediaURLsMustBeWebURLs() {
        #expect(MediaURL.parse("https://h.example/a.png") != nil)
        #expect(MediaURL.parse("javascript:alert(1)") == nil)
        #expect(MediaURL.parse("https:///nohost") == nil)
        #expect(MediaURL.parse(nil) == nil)
    }
}
