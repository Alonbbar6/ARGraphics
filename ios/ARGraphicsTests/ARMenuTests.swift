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

    @Test func spotCardComesFirstForTracking() throws {
        let json = """
        {"venue":\(Fixtures.venueSummary),"spot":{"label":"Table 6","placement":"table","tableCardId":"tc2"},
         "display":\(Fixtures.menuDisplay),"displays":[\(Fixtures.menuDisplay)],
         "tableCards":[\(Fixtures.tableCard),{"id":"tc2","name":"Patio card","referenceImageUrl":"https://h.example/patio.png","physicalWidthCm":9}]}
        """
        let onCard = try visit(json)
        #expect(onCard.spotCard?.id == "tc2")
        #expect(onCard.trackedCards.map(\.id) == ["tc2", "tc1"])
        // Older servers, or a code on no card: nothing is preferred and the order is kept.
        let plain = try visit(Fixtures.scanResult)
        #expect(plain.spot?.tableCardId == nil)
        #expect(plain.spotCard == nil)
        #expect(plain.trackedCards.map(\.id) == ["tc1"])
        // A spot pointing at a card that isn't in the list (e.g. switched off) is ignored.
        let missing = try visit(json.replacingOccurrences(of: "\"tableCardId\":\"tc2\"", with: "\"tableCardId\":\"gone\""))
        #expect(missing.spotCard == nil)
        #expect(missing.trackedCards.count == 2)
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
