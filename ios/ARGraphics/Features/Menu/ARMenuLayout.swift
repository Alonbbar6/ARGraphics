import simd

/// Pure placement math for the menu in AR, kept free of ARKit so it runs in Simulator tests.
///
/// Content lives in a code's frame, the one ARKit gives a tracked image: X across the code,
/// Y out of it (what things stand on), +Z toward the code's bottom edge, which is toward the
/// guest when the code is printed the way up they read it.
enum ARMenuLayout {
    /// Codes smaller than a postage stamp or bigger than a poster are misreads.
    static let widthRange: ClosedRange<Float> = 0.03...0.7
    /// A miniature stands this tall on the menu; tapping brings it to real size.
    static let miniatureHeight: Float = 0.085
    /// Arc length between neighbouring miniatures.
    static let spacing: Float = 0.13
    /// The arc never wraps further round than this, so it stays in front of the guest.
    static let maxSweep: Float = .pi * 0.85
    static let maxItems = 8

    /// The code's edge length from its four corners (in any consistent order) raycast onto a
    /// surface, each with the surface normal at that hit. Nil when the hits disagree about the
    /// surface, the shape isn't square-ish, or the size is implausible.
    static func codeWidth(corners: [SIMD3<Float>], normals: [SIMD3<Float>]) -> Float? {
        guard corners.count == 4, normals.count == 4 else { return nil }
        let up = simd_normalize(normals.reduce(SIMD3<Float>.zero, +))
        guard normals.allSatisfy({ simd_dot(simd_normalize($0), up) > 0.95 }) else { return nil }
        let edges = (0..<4).map { simd_length(corners[($0 + 1) % 4] - corners[$0]) }
        let width = edges.reduce(0, +) / 4
        guard widthRange.contains(width) else { return nil }
        // Square-ish: equal-ish sides (not a sliver) and equal-ish diagonals (not skewed).
        guard let shortest = edges.min(), let longest = edges.max(), shortest / longest > 0.6 else { return nil }
        let diagonalA = simd_length(corners[2] - corners[0])
        let diagonalB = simd_length(corners[3] - corners[1])
        guard min(diagonalA, diagonalB) / max(diagonalA, diagonalB) > 0.6 else { return nil }
        return width
    }

    /// Direction along a surface toward the guest; falls back to any tangent when the guest is
    /// straight above the point.
    static func forward(up: SIMD3<Float>, from center: SIMD3<Float>, toward camera: SIMD3<Float>) -> SIMD3<Float> {
        let normal = simd_normalize(up)
        let toCamera = camera - center
        var tangent = toCamera - normal * simd_dot(toCamera, normal)
        if simd_length(tangent) < 1e-3 {
            let helper: SIMD3<Float> = abs(normal.y) < 0.9 ? [0, 1, 0] : [0, 0, 1]
            tangent = helper - normal * simd_dot(helper, normal)
        }
        return simd_normalize(tangent)
    }

    /// A code-like frame on a bare surface, for when the code itself isn't in view:
    /// Y along `up`, +Z along the surface toward the guest.
    static func surfaceFrame(center: SIMD3<Float>, up: SIMD3<Float>, camera: SIMD3<Float>) -> simd_float4x4 {
        let y = simd_normalize(up)
        let z = forward(up: y, from: center, toward: camera)
        let x = simd_normalize(simd_cross(y, z))
        return simd_float4x4(columns: (SIMD4(x, 0), SIMD4(y, 0), SIMD4(z, 0), SIMD4(center, 1)))
    }

    /// Arc radius for `count` items around a code of `codeWidth`: clear of the code, and wide
    /// enough that the arc doesn't exceed `maxSweep`.
    static func radius(count: Int, codeWidth: Float) -> Float {
        let clearance = max(0.17, codeWidth / 2 + 0.11)
        guard count > 1 else { return clearance }
        return max(clearance, spacing * Float(count - 1) / maxSweep)
    }

    /// Miniature positions in the code's frame, left to right from the guest's view: an arc
    /// round the far side of the code (−Z) so nothing covers it.
    static func positions(count: Int, codeWidth: Float) -> [SIMD3<Float>] {
        guard count > 0 else { return [] }
        let r = radius(count: count, codeWidth: codeWidth)
        let sweep = count > 1 ? min(maxSweep, spacing * Float(count - 1) / r) : 0
        let step = count > 1 ? sweep / Float(count - 1) : 0
        return (0..<count).map { index in
            let angle = -sweep / 2 + step * Float(index)
            // Negative angle is the guest's left: X grows to the right when looking down -Z.
            return [sin(angle) * r, 0, -cos(angle) * r]
        }
    }

    /// Which displays make the AR menu: the ones with something to show, up to `maxItems`.
    static func menuDisplays(_ displays: [PublicDisplay]) -> [PublicDisplay] {
        Array(displays.filter { ExperienceContent(display: $0) != .none }.prefix(maxItems))
    }
}
