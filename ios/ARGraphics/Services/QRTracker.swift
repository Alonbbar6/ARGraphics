import ARKit
import CoreImage
import RealityKit
import Vision

#if !targetEnvironment(simulator)
/// Turns the printed code the guest scanned into an ARKit tracked image, so content can stand
/// on it and follow it when the card moves.
///
/// Printed codes come from the web app's encoder, which doesn't lay modules out the way Apple's
/// generator does, so a regenerated QR would never match the print. Instead the camera frame is
/// used: once Vision reads the code (and it's the one the guest scanned), that patch of the frame
/// is perspective-corrected into a flat, upright image and registered as an `ARReferenceImage`.
/// Its real size comes from raycasting the corners onto the surface; ARKit refines it from there.
@MainActor
final class QRTracker {
    /// Prefix of the reference image's name, so session delegates can tell it from table cards.
    static let namePrefix = "qr:"
    /// Extra print kept round the code (the quiet zone and a little card), as a fraction of
    /// the code's width per side. Gives ARKit more to hold on to than modules alone.
    static let margin: Float = 0.3
    /// Used until a measurement lands; `automaticImageScaleEstimationEnabled` corrects it.
    static let assumedCodeWidth: Float = 0.06

    let expectedCode: String
    private(set) var reference: ARReferenceImage?
    /// Width of the code itself (not the margin), in metres, once measured.
    private(set) var codeWidth: Float?
    private var busy = false
    private var lastAttempt = Date.distantPast
    private let queue = DispatchQueue(label: "app.argraphics.qr-tracker", qos: .userInitiated)
    private let context = CIContext()

    init(expectedCode: String) {
        self.expectedCode = expectedCode
    }

    /// Call from `session(_:didUpdate:)`. Cheap when nothing needs doing. `onReady` runs on the
    /// main actor once with the reference image and the measured code width.
    func consider(frame: ARFrame, in view: ARView, onReady: @escaping @MainActor (ARReferenceImage, Float) -> Void) {
        guard reference == nil, !busy, Date().timeIntervalSince(lastAttempt) > 0.3 else { return }
        lastAttempt = Date()
        busy = true
        let viewport = view.bounds.size
        let toView = frame.displayTransform(for: .portrait, viewportSize: viewport)
        let pixelBuffer = frame.capturedImage
        let expected = expectedCode
        queue.async { [weak self] in
            guard let corners = Self.codeCorners(in: pixelBuffer, expecting: expected) else {
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.busy = false } }
                return
            }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.finish(corners: corners, pixelBuffer: pixelBuffer, toView: toView, viewport: viewport, view: view, onReady: onReady)
                }
            }
        }
    }

    // MARK: Steps

    /// Corners in the camera buffer's normalized coordinates (origin bottom-left, as Vision and
    /// Core Image use), only for the code the guest scanned.
    private nonisolated static func codeCorners(in pixelBuffer: CVPixelBuffer, expecting code: String) -> [CGPoint]? {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
        try? handler.perform([request])
        guard let match = (request.results ?? []).first(where: { observation in
            guard let payload = observation.payloadStringValue, case .code(let seen)? = ScanLink.parse(payload) else { return false }
            return seen == code
        }) else { return nil }
        return [match.topLeft, match.topRight, match.bottomRight, match.bottomLeft]
    }

    private func finish(corners: [CGPoint], pixelBuffer: CVPixelBuffer, toView: CGAffineTransform, viewport: CGSize,
                        view: ARView, onReady: @escaping @MainActor (ARReferenceImage, Float) -> Void) {
        // Where each corner shows on screen, to name them (top-left of the code as the guest
        // sees it) and to measure the code on its surface.
        let onScreen = corners.map { corner -> CGPoint in
            let point = CGPoint(x: corner.x, y: 1 - corner.y).applying(toView)
            return CGPoint(x: point.x * viewport.width, y: point.y * viewport.height)
        }
        let ordered = Self.orderBySight(buffer: corners, screen: onScreen)
        let camera = view.cameraTransform.translation
        let measured = Self.measure(screenCorners: ordered.screen, in: view, camera: camera)
        let codeWidth = measured ?? Self.assumedCodeWidth
        let width = codeWidth * (1 + 2 * Self.margin)
        let name = Self.namePrefix + expectedCode
        let expanded = Self.expand(ordered.buffer, by: CGFloat(1 + 2 * Self.margin))
        let size = CGSize(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
        queue.async { [weak self, context] in
            guard let cgImage = Self.flatten(pixelBuffer: pixelBuffer, size: size, corners: expanded, context: context) else {
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.busy = false } }
                return
            }
            let image = ARReferenceImage(cgImage, orientation: .up, physicalWidth: CGFloat(width))
            image.name = name
            image.validate { error in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        self.busy = false
                        guard error == nil, self.reference == nil else { return }
                        self.reference = image
                        self.codeWidth = codeWidth
                        onReady(image, codeWidth)
                    }
                }
            }
        }
    }

    /// Names the corners by where they appear on screen: smallest x+y is top-left, and so on
    /// round the code. The flattened image then has the code upright as the guest sees it, so
    /// the image anchor's +Z (toward the image's bottom edge) points at the guest.
    static func orderBySight(buffer: [CGPoint], screen: [CGPoint]) -> (buffer: [CGPoint], screen: [CGPoint]) {
        guard buffer.count == 4, screen.count == 4 else { return (buffer, screen) }
        let indices = Array(0..<4)
        let topLeft = indices.min { screen[$0].x + screen[$0].y < screen[$1].x + screen[$1].y }!
        let bottomRight = indices.max { screen[$0].x + screen[$0].y < screen[$1].x + screen[$1].y }!
        let rest = indices.filter { $0 != topLeft && $0 != bottomRight }
        let topRight = rest.min { screen[$0].y - screen[$0].x < screen[$1].y - screen[$1].x }!
        let bottomLeft = rest.first { $0 != topRight }!
        let order = [topLeft, topRight, bottomRight, bottomLeft]
        return (order.map { buffer[$0] }, order.map { screen[$0] })
    }

    /// Mean edge length of the code on its surface, or nil when the corners don't all land on
    /// one surface.
    private static func measure(screenCorners: [CGPoint], in view: ARView, camera: SIMD3<Float>) -> Float? {
        var points: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        for corner in screenCorners {
            guard let hit = view.raycast(from: corner, allowing: .estimatedPlane, alignment: .any).first else { return nil }
            let t = hit.worldTransform
            points.append([t.columns.3.x, t.columns.3.y, t.columns.3.z])
            normals.append(ARMath.outwardNormal(hit: t, camera: camera))
        }
        return ARMenuLayout.codeWidth(corners: points, normals: normals)
    }

    /// Pushes each corner away from the quad's centre, keeping the print round the code.
    static func expand(_ corners: [CGPoint], by factor: CGFloat) -> [CGPoint] {
        let center = corners.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x / CGFloat(corners.count), y: $0.y + $1.y / CGFloat(corners.count)) }
        return corners.map { CGPoint(x: center.x + ($0.x - center.x) * factor, y: center.y + ($0.y - center.y) * factor) }
    }

    /// Perspective-corrects the code's patch of the frame into an upright square.
    private nonisolated static func flatten(pixelBuffer: CVPixelBuffer, size: CGSize, corners: [CGPoint], context: CIContext) -> CGImage? {
        guard corners.count == 4, let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
        let source = CIImage(cvPixelBuffer: pixelBuffer)
        let pixel = corners.map { CIVector(x: $0.x * size.width, y: $0.y * size.height) }
        filter.setValue(source, forKey: kCIInputImageKey)
        filter.setValue(pixel[0], forKey: "inputTopLeft")
        filter.setValue(pixel[1], forKey: "inputTopRight")
        filter.setValue(pixel[2], forKey: "inputBottomRight")
        filter.setValue(pixel[3], forKey: "inputBottomLeft")
        guard var flat = filter.outputImage else { return nil }
        // ARKit wants a reasonably sized reference; small or far codes get scaled up.
        let target: CGFloat = 800
        let scale = target / max(flat.extent.width, flat.extent.height)
        if scale > 1 { flat = flat.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
        guard flat.extent.width >= 200, flat.extent.height >= 200 else { return nil }
        return context.createCGImage(flat, from: flat.extent)
    }
}
#endif
