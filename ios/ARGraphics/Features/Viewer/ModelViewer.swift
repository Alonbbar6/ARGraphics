import RealityKit
import SwiftUI

/// Non-AR 3D turntable for when the camera is off or the phone can't do AR.
/// Drag to spin; also works in the Simulator.
struct ModelViewer: UIViewRepresentable {
    let model: ExperienceModel
    /// True inside a fixed-height frame; false full-screen, where a card covers the bottom.
    var centered = false

    func makeCoordinator() -> Coordinator { Coordinator(model: model, centered: centered) }

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
        view.environment.background = .color(.clear)
        view.backgroundColor = .clear
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ view: ARView, context: Context) {
        context.coordinator.modelFileChanged(model.modelFile)
    }

    static func dismantleUIView(_ view: ARView, coordinator: Coordinator) {
        coordinator.teardown()
    }

    @MainActor
    final class Coordinator: NSObject {
        private let model: ExperienceModel
        private weak var arView: ARView?
        private let root = AnchorEntity(world: .zero)
        private let turntable = Entity()
        private let camera = PerspectiveCamera()
        private static let verticalFOV: Float = 40
        private var loadedFile: URL?
        private var loadTask: Task<Void, Never>?
        private var yaw: Float = 0
        private var spin: Timer?

        private let centered: Bool

        init(model: ExperienceModel, centered: Bool) {
            self.model = model
            self.centered = centered
        }

        func attach(to view: ARView) {
            arView = view
            root.addChild(turntable)

            camera.camera.fieldOfViewInDegrees = Self.verticalFOV
            root.addChild(camera)
            frameCamera()

            let key = DirectionalLight()
            key.light.intensity = 3_000
            key.look(at: .zero, from: [0.4, 0.8, 0.6], relativeTo: nil)
            root.addChild(key)
            let fill = PointLight()
            fill.light.intensity = 12_000
            fill.light.color = UIColor(red: 0.66, green: 0.33, blue: 0.97, alpha: 1)
            fill.position = [-0.35, 0.2, 0.3]
            root.addChild(fill)
            view.scene.addAnchor(root)

            view.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:))))
            model.snapshotProvider = { [weak view] completion in
                guard let view else { return completion(nil) }
                view.snapshot(saveToHDR: false) { completion($0) }
            }
            if !UIAccessibility.isReduceMotionEnabled {
                spin = Timer.scheduledTimer(withTimeInterval: 1 / 60, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.rotate(by: 0.006) }
                }
            }
        }

        func teardown() {
            spin?.invalidate()
            loadTask?.cancel()
            model.snapshotProvider = nil
        }

        func modelFileChanged(_ file: URL?) {
            guard let file, file != loadedFile else { return }
            loadedFile = file
            loadTask?.cancel()
            loadTask = Task { [weak self] in
                do {
                    let entity = try await Entity(contentsOf: file)
                    guard let self, !Task.isCancelled else { return }
                    self.turntable.children.removeAll()
                    let container = ModelPreparation.normalizedContainer(for: entity)
                    self.turntable.addChild(container)
                    ModelPreparation.playBakedAnimations(in: container)
                    self.frameCamera()
                } catch {
                    self?.model.phase = .failed("This couldn't be opened here. Ask your server about it instead.")
                }
            }
        }

        /// Fits the model in the upper part of the screen (the card covers the bottom),
        /// whatever its size and the view's aspect ratio.
        func frameCamera() {
            let bounds = turntable.visualBounds(relativeTo: root)
            let radius = max(bounds.isEmpty ? ModelPreparation.itemHeight / 2 : bounds.boundingRadius, 0.01)
            let center = bounds.isEmpty ? SIMD3<Float>(0, ModelPreparation.itemHeight / 2, 0) : bounds.center
            let size = arView?.bounds.size ?? CGSize(width: 390, height: 844)
            let aspect = size.height > 0 ? Float(size.width / size.height) : 0.46
            let halfV = Self.verticalFOV * .pi / 360
            let halfH = atan(tan(halfV) * aspect)
            let distance = radius / sin(min(halfV, halfH)) * 1.25
            // Aim below the model so it sits in the top half of the frame.
            let target = center - SIMD3(0, centered ? 0 : radius * 0.9, 0)
            camera.look(at: target, from: target + SIMD3(0, radius * 0.6, distance), relativeTo: root)
        }

        private func rotate(by radians: Float) {
            yaw += radians
            turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
        }

        @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
            if gesture.state == .began { spin?.invalidate() }
            let dx = Float(gesture.translation(in: gesture.view).x)
            gesture.setTranslation(.zero, in: gesture.view)
            rotate(by: dx * 0.01)
        }
    }
}
