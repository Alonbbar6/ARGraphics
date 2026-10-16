import AVFoundation

/// The phone's flashlight, usable while ARKit owns the camera. In a dark bar it is the
/// single biggest help for finding table cards and surfaces.
enum Torch {
    static var isAvailable: Bool {
        AVCaptureDevice.default(for: .video)?.hasTorch ?? false
    }

    /// Turns the light on or off and returns whether it is now on.
    @discardableResult
    static func set(_ on: Bool) -> Bool {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else { return false }
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            if on {
                try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
            } else {
                device.torchMode = .off
            }
            return on
        } catch {
            return false
        }
    }
}
