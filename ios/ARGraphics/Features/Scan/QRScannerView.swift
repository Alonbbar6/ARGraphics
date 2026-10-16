import AVFoundation
import SwiftUI
import UIKit

/// Full-screen camera that reports QR code strings.
struct QRScannerView: UIViewControllerRepresentable {
    var isScanning: Bool
    var torchOn: Bool
    let onCode: (String) -> Void
    var onUnavailable: () -> Void = {}

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onCode = onCode
        controller.onUnavailable = onUnavailable
        return controller
    }

    func updateUIViewController(_ controller: ScannerViewController, context: Context) {
        controller.onCode = onCode
        controller.isScanning = isScanning
        controller.setTorch(torchOn)
    }

    static func dismantleUIViewController(_ controller: ScannerViewController, coordinator: ()) {
        controller.stop()
    }
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    var onUnavailable: (() -> Void)?
    var isScanning = true

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "app.argraphics.scanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var device: AVCaptureDevice?
    private var lastCode: String?
    private var lastCodeAt = Date.distantPast

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configure()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        start()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stop()
    }

    private func configure() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else {
            reportUnavailable()
            return
        }
        self.device = device
        session.beginConfiguration()
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            reportUnavailable()
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        session.commitConfiguration()

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.addSublayer(layer)
        previewLayer = layer
    }

    /// Deferred so SwiftUI state isn't mutated while the view is being made.
    private func reportUnavailable() {
        DispatchQueue.main.async { [weak self] in self?.onUnavailable?() }
    }

    func start() {
        sessionQueue.async { [session] in
            if !session.isRunning && !session.inputs.isEmpty { session.startRunning() }
        }
    }

    func stop() {
        sessionQueue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func setTorch(_ on: Bool) {
        guard let device, device.hasTorch, (device.torchMode == .on) != on else { return }
        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
        } catch {}
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard isScanning,
              let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first
        else { return }
        // The same code is reported every frame; only surface it again after a pause.
        if code == lastCode, Date().timeIntervalSince(lastCodeAt) < 2.5 { return }
        lastCode = code
        lastCodeAt = Date()
        onCode?(code)
    }
}
