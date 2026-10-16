import ReplayKit
import UIKit

/// The subtle "ARGraphics · {venue}" mark in the corner of shared photos.
enum Watermark {
    static func text(venue: String) -> String { "ARGraphics · \(venue)" }

    static func apply(to image: UIImage, venue: String) -> UIImage {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            image.draw(in: CGRect(origin: .zero, size: size))

            let unit = min(size.width, size.height) / 390
            let fontSize = max(11, 12 * unit)
            let margin = 16 * unit
            let mark = 10 * unit
            let shadow = NSShadow()
            shadow.shadowColor = UIColor.black.withAlphaComponent(0.55)
            shadow.shadowBlurRadius = 6 * unit
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
                .foregroundColor: UIColor.white.withAlphaComponent(0.82),
                .kern: 0.4 * unit,
                .shadow: shadow,
            ]
            let label = NSAttributedString(string: text(venue: venue), attributes: attributes)
            let labelSize = label.size()
            let origin = CGPoint(x: size.width - margin - labelSize.width,
                                 y: size.height - margin - labelSize.height)
            label.draw(at: origin)

            // Brand square, same gradient as the in-app mark.
            let square = CGRect(x: origin.x - mark - 6 * unit,
                                y: origin.y + (labelSize.height - mark) / 2,
                                width: mark, height: mark)
            let path = UIBezierPath(roundedRect: square, cornerRadius: 2.5 * unit)
            context.cgContext.saveGState()
            path.addClip()
            let colors = [UIColor(hex: 0x6D28D9), UIColor(hex: 0xA855F7), UIColor(hex: 0xF43F5E), UIColor(hex: 0xFB923C)]
                .map(\.cgColor) as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: nil) {
                context.cgContext.drawLinearGradient(gradient, start: square.origin,
                                                     end: CGPoint(x: square.maxX, y: square.maxY), options: [])
            }
            context.cgContext.restoreGState()
        }
    }
}

/// Short screen clips of the AR view through ReplayKit. The microphone stays off.
/// ReplayKit records the whole app window, so the experience screen hides its controls
/// while recording and leaves only the watermark on screen.
@MainActor
enum ClipRecorder {
    static let duration: Duration = .seconds(6)

    static var isAvailable: Bool { RPScreenRecorder.shared().isAvailable }

    static func start() async throws {
        let recorder = RPScreenRecorder.shared()
        recorder.isMicrophoneEnabled = false
        recorder.isCameraEnabled = false
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            recorder.startRecording { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    /// Stops and writes the clip to a temporary .mp4 for the share sheet.
    static func stop() async throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "ARGraphics-\(UUID().uuidString.prefix(8)).mp4")
        try await RPScreenRecorder.shared().stopRecording(withOutput: url)
        return url
    }

    static func cancel() {
        let recorder = RPScreenRecorder.shared()
        guard recorder.isRecording else { return }
        recorder.discardRecording {}
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: alpha)
    }
}
