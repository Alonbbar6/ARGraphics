import Foundation
import simd
import Testing
@testable import ARGraphics

struct ARMenuLayoutTests {
    private func close(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ tolerance: Float = 1e-4) -> Bool { simd_length(a - b) < tolerance }

    /// A 10 cm code lying flat, corners walked clockwise, phone held south of it.
    private let flatCorners: [SIMD3<Float>] = [[-0.05, 0, -0.05], [0.05, 0, -0.05], [0.05, 0, 0.05], [-0.05, 0, 0.05]]
    private let flatNormals = Array(repeating: SIMD3<Float>(0, 1, 0), count: 4)

    @Test func measuresTheCodeOnATable() throws {
        let width = try #require(ARMenuLayout.codeWidth(corners: flatCorners, normals: flatNormals))
        #expect(abs(width - 0.1) < 1e-4)
        // A code on a wall measures the same way.
        let wall: [SIMD3<Float>] = [[-0.1, 1.6, 0], [0.1, 1.6, 0], [0.1, 1.4, 0], [-0.1, 1.4, 0]]
        let wallWidth = try #require(ARMenuLayout.codeWidth(corners: wall, normals: Array(repeating: [0, 0, 1], count: 4)))
        #expect(abs(wallWidth - 0.2) < 1e-4)
    }

    @Test func rejectsImplausibleReads() {
        // Normals that disagree: corners landed on two different surfaces.
        var mixed = flatNormals
        mixed[2] = [0, 0, 1]
        #expect(ARMenuLayout.codeWidth(corners: flatCorners, normals: mixed) == nil)
        // A code the size of a wall.
        #expect(ARMenuLayout.codeWidth(corners: flatCorners.map { $0 * 20 }, normals: flatNormals) == nil)
        // A sliver, not a square.
        let sliver: [SIMD3<Float>] = [[-0.05, 0, -0.005], [0.05, 0, -0.005], [0.05, 0, 0.005], [-0.05, 0, 0.005]]
        #expect(ARMenuLayout.codeWidth(corners: sliver, normals: flatNormals) == nil)
        #expect(ARMenuLayout.codeWidth(corners: Array(flatCorners.prefix(3)), normals: flatNormals) == nil)
    }

    @Test func surfaceFrameFacesTheGuest() {
        // Guest south of the spot: +Z toward them, Y up, X to their right.
        let t = ARMenuLayout.surfaceFrame(center: .zero, up: [0, 1, 0], camera: [0, 0.6, 0.5])
        #expect(close([t.columns.2.x, t.columns.2.y, t.columns.2.z], [0, 0, 1]))
        #expect(close([t.columns.1.x, t.columns.1.y, t.columns.1.z], [0, 1, 0]))
        #expect(close([t.columns.0.x, t.columns.0.y, t.columns.0.z], [1, 0, 0]))
        // Straight above: still a unit tangent along the surface.
        let forward = ARMenuLayout.forward(up: [0, 1, 0], from: .zero, toward: [0, 1, 0])
        #expect(abs(simd_length(forward) - 1) < 1e-4)
        #expect(abs(forward.y) < 1e-4)
    }

    @Test func arcSitsBehindTheCodeLeftToRight() {
        let positions = ARMenuLayout.positions(count: 3, codeWidth: 0.1)
        #expect(positions.count == 3)
        // All behind the code (-Z), on the surface, symmetric, ordered left (−X) to right (+X).
        #expect(positions.allSatisfy { $0.z < 0 && abs($0.y) < 1e-6 })
        #expect(positions[0].x < positions[1].x && positions[1].x < positions[2].x)
        #expect(abs(positions[0].x + positions[2].x) < 1e-5)
        #expect(abs(positions[1].x) < 1e-5)
        // Every miniature is clear of the code and equally far from its centre.
        let r = ARMenuLayout.radius(count: 3, codeWidth: 0.1)
        #expect(r > 0.05 + 0.1)
        #expect(positions.allSatisfy { abs(simd_length($0) - r) < 1e-5 })
        // Neighbours keep the spacing apart along the arc.
        let gap = simd_length(positions[1] - positions[0])
        #expect(gap > ARMenuLayout.spacing * 0.9 && gap <= ARMenuLayout.spacing)
    }

    @Test func arcWidensForMoreItemsAndBiggerCodes() {
        #expect(ARMenuLayout.radius(count: 8, codeWidth: 0.1) > ARMenuLayout.radius(count: 3, codeWidth: 0.1))
        #expect(ARMenuLayout.radius(count: 3, codeWidth: 0.4) > ARMenuLayout.radius(count: 3, codeWidth: 0.1))
        let many = ARMenuLayout.positions(count: 8, codeWidth: 0.1)
        // Never wraps round in front of the guest.
        #expect(many.allSatisfy { $0.z < 0.01 })
        #expect(ARMenuLayout.positions(count: 1, codeWidth: 0.1).first.map { $0.x == 0 && $0.z < 0 } == true)
        #expect(ARMenuLayout.positions(count: 0, codeWidth: 0.1).isEmpty)
    }

}

@MainActor
struct ARMenuRoutingTests {
    private func visit(_ json: String, code: String = "k7m2qx9a") throws -> Visit {
        Visit(scan: try JSONDecoder.api.decode(ScanResult.self, from: Data(json.utf8)), code: code)
    }

    private let severalNoDisplay = """
    {"venue":\(Fixtures.venueSummary),"spot":{"label":"Service window","placement":"window"},
     "display":null,"displays":[\(Fixtures.menuDisplay),\(Fixtures.artDisplay),\(Fixtures.offerDisplay),\(Fixtures.eventDisplay)],"tableCards":[]}
    """

    @Test func menuOnlyForScannedCodesWithSeveralThingsToPlace() throws {
        let several = try visit(severalNoDisplay)
        #expect(MenuExperienceModel.canShow(several, cameraStatus: .authorized, arSupported: true))
        // One pointed display opens directly; one placeable item isn't a menu; venue links have no printed code.
        #expect(!MenuExperienceModel.canShow(try visit(Fixtures.scanResult), cameraStatus: .authorized, arSupported: true))
        #expect(!MenuExperienceModel.canShow(try visit(Fixtures.scanResultNoDisplay), cameraStatus: .authorized, arSupported: true))
        let link = Visit(venue: try JSONDecoder.api.decode(PublicVenue.self, from: Data(Fixtures.publicVenue.utf8)))
        #expect(!MenuExperienceModel.canShow(link, cameraStatus: .authorized, arSupported: true))
        // No camera or no ARKit: the list instead.
        #expect(!MenuExperienceModel.canShow(several, cameraStatus: .denied, arSupported: true))
        #expect(!MenuExperienceModel.canShow(several, cameraStatus: .authorized, arSupported: false))
    }

    @Test func anchorFollowsTheVenueChoice() throws {
        let base = """
        {"venue":\(Fixtures.venueSummary),"spot":{"label":"Table 6","placement":"table",ANCHOR},
         "display":\(Fixtures.menuDisplay),"displays":[\(Fixtures.menuDisplay)],
         "tableCards":[\(Fixtures.tableCard),{"id":"tc2","name":"Patio card","referenceImageUrl":"https://h.example/patio.png","physicalWidthCm":9}]}
        """
        // The printed code: track only the code, at the width the venue measured.
        let qr = try visit(base.replacingOccurrences(of: "ANCHOR", with: "\"anchor\":\"qr\",\"qrWidthCm\":5.5,\"qrImageUrl\":\"https://h.example/api/v1/codes/k7m2qx9a/qr.png\""))
        #expect(qr.anchor == .qr)
        #expect(qr.tracksCode)
        #expect(abs((qr.spot?.qrWidth ?? 0) - 0.055) < 1e-6)
        #expect(qr.trackedCards.isEmpty)
        #expect(qr.spotCard == nil)
        // A card design: track only that card.
        let card = try visit(base.replacingOccurrences(of: "ANCHOR", with: "\"anchor\":\"card\",\"tableCardId\":\"tc2\""))
        #expect(card.anchor == .card)
        #expect(!card.tracksCode)
        #expect(card.spotCard?.id == "tc2")
        #expect(card.trackedCards.map(\.id) == ["tc2"])
        // The table: no code tracking; any registered card art still counts, as before.
        let surface = try visit(base.replacingOccurrences(of: "ANCHOR", with: "\"anchor\":\"surface\""))
        #expect(surface.anchor == .surface)
        #expect(!surface.tracksCode)
        #expect(surface.trackedCards.map(\.id) == ["tc1", "tc2"])
        // Older servers send none of this; a venue link has no printed code at all.
        let legacy = try visit(Fixtures.scanResult)
        #expect(legacy.anchor == .surface && !legacy.tracksCode)
        let link = Visit(venue: try JSONDecoder.api.decode(PublicVenue.self, from: Data(Fixtures.publicVenue.utf8)))
        #expect(link.anchor == .surface && !link.tracksCode)
        // An anchor value this build doesn't know decodes safely and behaves like a surface.
        let future = try visit(base.replacingOccurrences(of: "ANCHOR", with: "\"anchor\":\"hologram\""))
        #expect(future.spot?.anchor == .unknown && future.anchor == .surface)
        #expect(abs((future.spot?.qrWidth ?? 0) - 0.04) < 1e-6, "default printed width when unmeasured")
    }

    @Test func menuKeepsOnlyPlaceableItemsInOrder() throws {
        let model = MenuExperienceModel(visit: try visit(severalNoDisplay))
        // The offer and event have no media, so they're left to the list.
        #expect(model.items.map(\.id) == ["dsp_menu1", "dsp_art1"])
        #expect(model.overflowCount == 2)
        #expect(model.expectedCode == "k7m2qx9a")
        #expect(model.readyCount == 0)
        model.select("dsp_art1")
        #expect(model.selected?.display.title == "Night Bloom")
        model.select(nil)
        #expect(model.selected == nil)
    }
}
