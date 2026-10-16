import Foundation
import simd
import Testing
@testable import ARGraphics

final class MemoryStore: ValueStore {
    var value: String?
    var failsWrites = false
    private(set) var writes = 0

    init(_ value: String? = nil, failsWrites: Bool = false) {
        self.value = value
        self.failsWrites = failsWrites
    }

    func read() -> String? { value }

    func write(_ value: String) -> Bool {
        writes += 1
        guard !failsWrites else { return false }
        self.value = value
        return true
    }
}

struct VisitorIdentityTests {
    @Test func generatesContractValidID() {
        let id = VisitorIdentity(primary: MemoryStore(), fallback: MemoryStore()).id
        #expect(VisitorIdentity.isValid(id))
        #expect(id.range(of: "^[A-Za-z0-9-]{16,64}$", options: .regularExpression) != nil)
    }

    @Test func persistsAcrossInstances() {
        let keychain = MemoryStore()
        let first = VisitorIdentity(primary: keychain, fallback: MemoryStore()).id
        let second = VisitorIdentity(primary: keychain, fallback: MemoryStore()).id
        #expect(first == second)
        #expect(keychain.writes == 1)
    }

    @Test func stableWithinOneInstance() {
        let identity = VisitorIdentity(primary: MemoryStore(), fallback: MemoryStore())
        #expect(identity.id == identity.id)
    }

    @Test func fallsBackWhenKeychainFails() {
        let keychain = MemoryStore(failsWrites: true)
        let defaults = MemoryStore()
        let first = VisitorIdentity(primary: keychain, fallback: defaults).id
        #expect(defaults.value == first)
        let second = VisitorIdentity(primary: keychain, fallback: defaults).id
        #expect(first == second)
    }

    @Test func movesFallbackIntoKeychain() {
        let keychain = MemoryStore()
        let defaults = MemoryStore("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        let id = VisitorIdentity(primary: keychain, fallback: defaults).id
        #expect(id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        #expect(keychain.value == id)
    }

    @Test func replacesInvalidStoredValue() {
        let keychain = MemoryStore("bad id!")
        let id = VisitorIdentity(primary: keychain, fallback: MemoryStore()).id
        #expect(id != "bad id!")
        #expect(VisitorIdentity.isValid(id))
    }

    @Test func validator() {
        #expect(VisitorIdentity.isValid(String(repeating: "a", count: 16)))
        #expect(VisitorIdentity.isValid(String(repeating: "a", count: 64)))
        #expect(!VisitorIdentity.isValid(String(repeating: "a", count: 15)))
        #expect(!VisitorIdentity.isValid(String(repeating: "a", count: 65)))
        #expect(!VisitorIdentity.isValid("aaaaaaaaaaaaaaaa_"))
    }

    @Test func keychainRoundTrip() {
        let store = KeychainValueStore(service: "app.argraphics.visitor.tests", account: UUID().uuidString)
        if store.write("first-value-0123456") {
            #expect(store.read() == "first-value-0123456")
            #expect(store.write("second-value-0123456"))
            #expect(store.read() == "second-value-0123456")
        }
    }
}

struct CountdownTests {
    let countdown = Countdown(timeZone: TimeZone(identifier: "America/New_York")!, locale: Locale(identifier: "en_US"))
    let claimedAt = APIDate.parse("2026-10-15T00:14:00Z")!  // 8:14 PM in New York

    @Test(arguments: [
        (0.0, "00:00"),
        (-5.0, "00:00"),
        (59.9, "00:59"),
        (892.0, "14:52"),
        (3599.0, "59:59"),
        (3600.0, "01:00:00"),
        (6130.0, "01:42:10"),
        (36_000.0, "10:00:00"),
    ])
    func clock(_ seconds: Double, _ expected: String) {
        #expect(Countdown.clock(seconds) == expected)
    }

    @Test func claimLineCountsDownWithSeconds() {
        let expires = claimedAt.addingTimeInterval(15 * 60)
        let now = claimedAt.addingTimeInterval(8)
        #expect(countdown.claimLine(claimedAt: claimedAt, expiresAt: expires, now: now) == "Claimed 8:14 PM · valid for 14:52")
        #expect(countdown.claimLine(claimedAt: claimedAt, expiresAt: expires, now: now.addingTimeInterval(1))
            == "Claimed 8:14 PM · valid for 14:51")
    }

    @Test func claimLineAfterExpiry() {
        let expires = claimedAt.addingTimeInterval(15 * 60)
        #expect(countdown.claimLine(claimedAt: claimedAt, expiresAt: expires, now: expires)
            == "Claimed 8:14 PM · expired 8:29 PM")
    }

    @Test func liveClockHasSeconds() {
        #expect(countdown.timeWithSeconds(claimedAt.addingTimeInterval(3)) == "8:14:03 PM")
    }

    @Test func offerEnds() {
        #expect(countdown.offerEnds(APIDate.parse("2026-10-15T02:00:00Z")!) == "Ends at 10:00 PM")
        #expect(Countdown.isExpired(claimedAt, now: claimedAt))
        #expect(!Countdown.isExpired(nil, now: claimedAt))
    }

    @Test func walkingTime() {
        #expect(Countdown.walk(meters: 0) == "1 min walk")
        #expect(Countdown.walk(meters: 240) == "3 min walk")
        #expect(Countdown.walk(meters: 241) == "4 min walk")
    }
}

struct ARMathTests {
    private func rotated(_ q: simd_quatf, _ v: SIMD3<Float>) -> SIMD3<Float> { q.act(v) }

    private func close(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Bool { simd_length(a - b) < 1e-4 }

    @Test func panelFacesTheGivenDirectionAndStaysUpright() {
        let q = ARMath.facing([1, 0, 0])
        #expect(close(rotated(q, [0, 0, 1]), [1, 0, 0]))
        #expect(close(rotated(q, [0, 1, 0]), [0, 1, 0]))
    }

    @Test func verticalComponentIsIgnored() {
        let q = ARMath.facing([0, 5, -1])
        #expect(close(rotated(q, [0, 0, 1]), [0, 0, -1]))
        #expect(close(rotated(q, [0, 1, 0]), [0, 1, 0]))
        #expect(close(rotated(ARMath.facing([0, 1, 0]), [0, 0, 1]), [0, 0, 1]))
    }

    @Test func wallNormalPointsAtCamera() {
        var hit = matrix_identity_float4x4
        hit.columns.1 = [0, 0, -1, 0]  // plane normal away from the camera
        hit.columns.3 = [0, 1, -2, 1]
        #expect(close(ARMath.outwardNormal(hit: hit, camera: [0, 1, 0]), [0, 0, 1]))
    }

    @Test func panelSizes() {
        let wall = ARMath.panelSize(imageSize: CGSize(width: 800, height: 1000), placement: .wall, framed: true)
        #expect(abs(wall.x - 0.9) < 1e-4)
        #expect(abs(wall.y - 1.125) < 1e-4)
        let tall = ARMath.panelSize(imageSize: CGSize(width: 100, height: 1000), placement: .table, framed: false)
        #expect(abs(tall.y - 0.32) < 1e-4)
        #expect(tall.x < 0.24)
    }
}
