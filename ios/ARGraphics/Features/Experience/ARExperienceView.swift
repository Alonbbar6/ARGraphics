import ARKit
import RealityKit
import SwiftUI

#if targetEnvironment(simulator)
/// The Simulator's RealityKit lacks ARKit anchoring symbols, and ARKit reports itself
/// unsupported there, so ExperienceModel always picks the flat page instead.
struct ARExperienceView: View {
    let model: ExperienceModel
    var body: some View { Color.clear }
}
#else
/// Live AR. Menu items stand on a recognised table card, or on the nearest table surface.
/// Art pieces hang flat on a wall or window; table content floats just above the table.
/// A Coral marker sits under whatever was placed. Tap to move it.
struct ARExperienceView: UIViewRepresentable {
    let model: ExperienceModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        view.environment.sceneUnderstanding.options = []
        view.renderOptions.insert(.disableMotionBlur)
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ view: ARView, context: Context) {
        context.coordinator.contentChanged(modelFile: model.modelFile, image: model.panelImage)
    }

    static func dismantleUIView(_ view: ARView, coordinator: Coordinator) {
        coordinator.teardown()
    }

    @MainActor
    final class Coordinator: NSObject, ARSessionDelegate {
        private let model: ExperienceModel
        private weak var arView: ARView?
        private var loadedKey: String?
        private var content: ModelEntity?
        private var marker: ModelEntity?
        private var contentSize: SIMD2<Float> = [0.2, 0.2]
        private var anchor: AnchorEntity?
        private var placedOnCard = false
        private var startedAt = Date()
        private var hasReferenceImages = false
        private var placementTimer: Timer?
        private var loadTask: Task<Void, Never>?

        /// Flat art hangs on walls and windows; a 3D model always stands on a table or floor.
        private var vertical: Bool { model.placement.isVertical && !model.content.isModel }
        private var alignment: ARRaycastQuery.TargetAlignment { vertical ? .vertical : .horizontal }

        init(model: ExperienceModel) {
            self.model = model
        }

        func attach(to view: ARView) {
            arView = view
            view.session.delegate = self
            view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap(_:))))
            runSession(referenceImages: [])
            loadReferenceImages()

            model.snapshotProvider = { [weak view] completion in
                guard let view else { return completion(nil) }
                view.snapshot(saveToHDR: false) { completion($0) }
            }

            placementTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tryPlaneFallback() }
            }
        }

        func teardown() {
            placementTimer?.invalidate()
            loadTask?.cancel()
            arView?.session.pause()
            model.snapshotProvider = nil
        }

        private func runSession(referenceImages: Set<ARReferenceImage>) {
            guard let arView else { return }
            let config = ARWorldTrackingConfiguration()
            config.planeDetection = vertical ? [.vertical] : [.horizontal]
            config.environmentTexturing = .automatic
            config.detectionImages = referenceImages
            config.maximumNumberOfTrackedImages = referenceImages.isEmpty ? 0 : 1
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
                config.frameSemantics.insert(.personSegmentationWithDepth)
            }
            // Keep tracking and anchors when adding reference images mid-session.
            arView.session.run(config, options: [])
        }

        // MARK: Table cards

        private func loadReferenceImages() {
            let cards = model.tableCards
            guard !cards.isEmpty else { return }
            Task { [weak self] in
                let images = await ReferenceImageLoader.load(cards)
                guard let self, !images.isEmpty else { return }
                self.hasReferenceImages = true
                self.startedAt = Date()
                self.runSession(referenceImages: images)
            }
        }

        // MARK: Content

        func contentChanged(modelFile: URL?, image: UIImage?) {
            let key: String
            if let modelFile { key = modelFile.absoluteString }
            else if let image { key = "image-\(ObjectIdentifier(image).hashValue)" }
            else { return }
            guard key != loadedKey else { return }
            loadedKey = key
            loadTask?.cancel()
            loadTask = Task { [weak self] in
                do {
                    guard let self else { return }
                    let built: ModelEntity
                    var gestures: ARView.EntityGestures = [.scale]
                    if let modelFile {
                        built = ModelPreparation.normalizedContainer(
                            for: try await Entity(contentsOf: modelFile),
                            height: self.model.display.modelHeight ?? ModelPreparation.itemHeight
                        )
                        let extents = built.visualBounds(relativeTo: built).extents
                        self.contentSize = [max(extents.x, extents.z), extents.y]
                        gestures.insert(.rotation)
                    } else if let image {
                        let framed: Bool
                        if case .panel(_, let isFramed) = self.model.content { framed = isFramed } else { framed = false }
                        let size = ARMath.panelSize(imageSize: image.size, placement: self.model.placement, framed: framed)
                        built = try await ARContentBuilder.panel(image: image, framed: framed, size: size)
                        self.contentSize = size
                    } else {
                        return
                    }
                    let markerSize = self.vertical ? 0.08 : max(0.14, self.contentSize.x * 1.15)
                    let marker = try await ARContentBuilder.marker(diameter: markerSize, horizontal: !self.vertical)
                    guard !Task.isCancelled else { return }
                    self.content = built
                    self.marker = marker
                    self.arView?.installGestures(gestures, for: built)
                } catch {
                    self?.model.phase = .failed("This couldn't be opened here. Ask your server about it instead.")
                }
            }
        }

        /// Puts the content and marker on an anchor. `facing` orients flat content
        /// (wall normal, or toward the guest for table cards).
        private func place(at anchorEntity: AnchorEntity, facing: SIMD3<Float>?, onCard: Bool) {
            guard let arView, let content, let marker else { return }
            anchor?.removeFromParent()
            content.removeFromParent()
            marker.removeFromParent()
            anchorEntity.addChild(content)
            anchorEntity.addChild(marker)

            if model.modelFile != nil {
                content.position = .zero
                marker.position = [0, 0.001, 0]
            } else if vertical {
                let rotation = ARMath.facing(facing ?? [0, 0, 1])
                content.orientation = rotation
                // Slightly off the wall so it never flickers into the paint.
                content.position = rotation.act([0, 0, 0.01])
                marker.orientation = rotation
                marker.position = rotation.act([0, -contentSize.y / 2 - 0.07, 0.011])
            } else {
                content.orientation = ARMath.facing(facing ?? [0, 0, 1])
                content.position = [0, ARContentBuilder.tableLift + contentSize.y / 2, 0]
                marker.position = [0, 0.001, 0]
            }

            arView.scene.addAnchor(anchorEntity)
            anchor = anchorEntity
            if model.modelFile != nil { ModelPreparation.playBakedAnimations(in: content) }
            placedOnCard = onCard

            if !UIAccessibility.isReduceMotionEnabled, model.phase == .finding {
                let final = content.transform
                content.transform.scale = SIMD3(repeating: 0.01)
                content.move(to: final, relativeTo: anchorEntity, duration: 0.45, timingFunction: .easeOut)
            }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            model.phase = .placed(onCard: onCard)
        }

        private var cameraPosition: SIMD3<Float> {
            arView?.cameraTransform.translation ?? .zero
        }

        private func place(hit: ARRaycastResult) {
            let position = SIMD3<Float>(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
            if model.modelFile != nil {
                place(at: AnchorEntity(world: hit.worldTransform), facing: nil, onCard: false)
            } else if vertical {
                let normal = ARMath.outwardNormal(hit: hit.worldTransform, camera: cameraPosition)
                place(at: AnchorEntity(world: position), facing: normal, onCard: false)
            } else {
                place(at: AnchorEntity(world: position), facing: cameraPosition - position, onCard: false)
            }
        }

        /// No card recognised after a few seconds: use the surface under the screen center.
        private func tryPlaneFallback() {
            guard let arView, content != nil, anchor == nil else { return }
            let wait: TimeInterval = hasReferenceImages ? 4 : 1
            guard Date().timeIntervalSince(startedAt) > wait else { return }
            let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY * (vertical ? 0.9 : 1.2))
            guard let hit = arView.raycast(from: center, allowing: .estimatedPlane, alignment: alignment).first else { return }
            place(hit: hit)
        }

        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let arView, content != nil else { return }
            let point = gesture.location(in: arView)
            guard let hit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: alignment).first else { return }
            place(hit: hit)
        }

        // MARK: ARSessionDelegate

        nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            let images = anchors.compactMap { $0 as? ARImageAnchor }
            guard let image = images.first else { return }
            let identifier = image.identifier
            let transform = image.transform
            MainActor.assumeIsolated {
                // A recognised table card always wins over a guessed surface.
                guard !placedOnCard, content != nil else { return }
                if model.modelFile != nil {
                    place(at: AnchorEntity(.anchor(identifier: identifier)), facing: nil, onCard: true)
                } else {
                    let position = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
                    place(at: AnchorEntity(world: position), facing: cameraPosition - position, onCard: true)
                }
            }
        }

        nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
            let code = (error as? ARError)?.code
            MainActor.assumeIsolated {
                if code == .cameraUnauthorized {
                    model.cameraDenied()
                } else {
                    model.phase = .failed("AR stopped. Move to a brighter spot and try again.")
                }
            }
        }
    }
}

#endif

enum ReferenceImageLoader {
    /// Downloads table-card artwork and keeps only images ARKit can actually track;
    /// one bad image would otherwise fail the whole session.
    static func load(_ cards: [PublicTableCard]) async -> Set<ARReferenceImage> {
        await withTaskGroup(of: ARReferenceImage?.self) { group in
            for card in cards.prefix(25) {
                group.addTask { await referenceImage(for: card) }
            }
            var result = Set<ARReferenceImage>()
            for await image in group { if let image { result.insert(image) } }
            return result
        }
    }

    private static func referenceImage(for card: PublicTableCard) async -> ARReferenceImage? {
        guard card.physicalWidthCm > 0, let url = MediaURL.parse(card.referenceImageUrl),
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let cgImage = UIImage(data: data)?.cgImage
        else { return nil }
        let image = ARReferenceImage(cgImage, orientation: .up, physicalWidth: card.physicalWidthCm / 100)
        image.name = card.id
        let valid = await withCheckedContinuation { continuation in
            image.validate { continuation.resume(returning: $0 == nil) }
        }
        return valid ? image : nil
    }
}
