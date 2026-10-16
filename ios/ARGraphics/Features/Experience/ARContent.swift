import RealityKit
import simd
import UIKit

/// Pure placement math, kept free of ARKit so it can be unit tested in the Simulator.
enum ARMath {
    /// Rotation that turns a +Z-facing panel to face `direction` horizontally, top edge up.
    /// Used for wall pieces (direction = wall normal) and table cards (direction = toward the guest).
    static func facing(_ direction: SIMD3<Float>) -> simd_quatf {
        var z = SIMD3<Float>(direction.x, 0, direction.z)
        if simd_length(z) < 1e-4 { z = [0, 0, 1] }
        z = simd_normalize(z)
        let y = SIMD3<Float>(0, 1, 0)
        let x = simd_normalize(simd_cross(y, z))
        return simd_quatf(simd_float3x3(columns: (x, y, z)))
    }

    /// Plane normal from a raycast transform (its Y axis), flipped to point at the camera.
    static func outwardNormal(hit: simd_float4x4, camera: SIMD3<Float>) -> SIMD3<Float> {
        let normal = SIMD3<Float>(hit.columns.1.x, hit.columns.1.y, hit.columns.1.z)
        let position = SIMD3<Float>(hit.columns.3.x, hit.columns.3.y, hit.columns.3.z)
        return simd_dot(normal, camera - position) < 0 ? -normal : normal
    }

    /// Real-world width for flat content, by where it's placed.
    static func panelWidth(placement: Placement, framed: Bool) -> Float {
        switch placement {
        case .wall: return framed ? 0.9 : 0.7
        case .window: return 0.6
        case .poster: return 0.5
        case .table, .unknown: return 0.24
        }
    }

    static func panelSize(imageSize: CGSize, placement: Placement, framed: Bool) -> SIMD2<Float> {
        var width = panelWidth(placement: placement, framed: framed)
        let aspect = imageSize.width > 0 ? Float(imageSize.height / imageSize.width) : 1
        let maxHeight: Float = placement.isVertical ? 1.2 : 0.32
        var height = width * aspect
        if height > maxHeight {
            width *= maxHeight / height
            height = maxHeight
        }
        return [width, height]
    }
}

/// Builds the RealityKit entities for flat artwork, its glow, and the Coral anchor marker.
@MainActor
enum ARContentBuilder {
    /// Distance between a table card's bottom edge and the table, so it reads as floating.
    static let tableLift: Float = 0.03

    /// A panel centered on its origin, facing +Z, with a soft Orchid glow behind it.
    static func panel(image: UIImage, framed: Bool, size: SIMD2<Float>) async throws -> ModelEntity {
        let container = ModelEntity()

        let artwork = try await texture(from: framed ? framedImage(image) : roundedImage(image))
        let front = ModelEntity(mesh: .generatePlane(width: size.x, height: size.y), materials: [material(artwork)])
        container.addChild(front)

        let glowTexture = try await texture(from: glowImage())
        let glow = ModelEntity(mesh: .generatePlane(width: size.x * 1.7, height: size.y * 1.5),
                               materials: [material(glowTexture)])
        glow.position.z = -0.004
        container.addChild(glow)

        container.collision = CollisionComponent(shapes: [.generateBox(size: [size.x, size.y, 0.01])])
        return container
    }

    /// Coral ring that sits flat under table content, or just below wall content.
    static func marker(diameter: Float, horizontal: Bool) async throws -> ModelEntity {
        let ring = try await texture(from: ringImage())
        let mesh: MeshResource = horizontal
            ? .generatePlane(width: diameter, depth: diameter)
            : .generatePlane(width: diameter, height: diameter)
        return ModelEntity(mesh: mesh, materials: [material(ring)])
    }

    private static func material(_ texture: TextureResource) -> UnlitMaterial {
        var material = UnlitMaterial()
        material.color = .init(tint: .white, texture: .init(texture))
        material.blending = .transparent(opacity: .init(floatLiteral: 1))
        return material
    }

    private static func texture(from image: UIImage) async throws -> TextureResource {
        guard let cgImage = image.cgImage else { throw AssetError.download }
        return try await TextureResource(image: cgImage, options: .init(semantic: .color))
    }

    // MARK: Textures

    private static func renderer(_ size: CGSize) -> UIGraphicsImageRenderer {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format)
    }

    /// Gallery frame: a dark mat with a thin Spotlight inner line.
    private static func framedImage(_ image: UIImage) -> UIImage {
        let longest: CGFloat = 1600
        let scale = min(1, longest / max(image.size.width, image.size.height))
        let inner = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let border = max(inner.width, inner.height) * 0.04
        let size = CGSize(width: inner.width + border * 2, height: inner.height + border * 2)
        return renderer(size).image { context in
            UIColor(hex: 0x14102A).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let artRect = CGRect(x: border, y: border, width: inner.width, height: inner.height)
            image.draw(in: artRect)
            UIColor(hex: 0xFDE68A, alpha: 0.6).setStroke()
            let line = UIBezierPath(rect: artRect.insetBy(dx: -border * 0.25, dy: -border * 0.25))
            line.lineWidth = max(1, border * 0.06)
            line.stroke()
        }
    }

    private static func roundedImage(_ image: UIImage) -> UIImage {
        let longest: CGFloat = 1600
        let scale = min(1, longest / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return renderer(size).image { _ in
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: min(size.width, size.height) * 0.06).addClip()
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    private static func glowImage() -> UIImage {
        let size = CGSize(width: 256, height: 256)
        return renderer(size).image { context in
            let colors = [UIColor(hex: 0xA855F7, alpha: 0.55), UIColor(hex: 0x6D28D9, alpha: 0.25), UIColor(hex: 0x6D28D9, alpha: 0)]
                .map(\.cgColor) as CFArray
            guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.55, 1])
            else { return }
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            context.cgContext.drawRadialGradient(gradient, startCenter: center, startRadius: 0,
                                                 endCenter: center, endRadius: size.width / 2, options: [])
        }
    }

    private static func ringImage() -> UIImage {
        let size = CGSize(width: 256, height: 256)
        return renderer(size).image { context in
            let coral = UIColor(hex: 0xF43F5E)
            let rect = CGRect(origin: .zero, size: size)
            coral.withAlphaComponent(0.18).setFill()
            context.cgContext.fillEllipse(in: rect.insetBy(dx: 24, dy: 24))
            coral.setStroke()
            context.cgContext.setLineWidth(10)
            context.cgContext.strokeEllipse(in: rect.insetBy(dx: 16, dy: 16))
            coral.setFill()
            context.cgContext.fillEllipse(in: CGRect(x: size.width / 2 - 14, y: size.height / 2 - 14, width: 28, height: 28))
        }
    }
}
