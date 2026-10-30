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
/// Live AR. The venue's printed cards are ARKit tracked images: content stands on the card
/// the guest scanned and follows it when they pick it up. In order of preference it anchors
/// to this spot's card, any of the venue's cards, the printed code itself (captured from the
/// camera, see QRTracker), and only then a guessed surface: menu items on the nearest table,
/// art flat on a wall or window. A Coral marker sits under whatever was placed. Tap to move it.
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

    /// Where the content is anchored, best first. A better anchor replaces a worse one.
    enum Anchoring: Int, Comparable {
        case none = 0
        /// A guessed table or wall under the screen centre, or where the guest tapped.
        case surface
        /// The printed code, captured from the camera because no card was registered.
        case capturedCode
        /// One of the venue's registered cards.
        case venueCard
        /// The card this code is printed on.
        case spotCard

        static func < (lhs: Anchoring, rhs: Anchoring) -> Bool { lhs.rawValue < rhs.rawValue }
        /// Tracked anchors follow the print; content stands on it in the image's own frame.
        var tracksAnImage: Bool { self >= .capturedCode }
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
        private var anchoring: Anchoring = .none
        /// Image anchors ARKit has reported, by how good they are, until content is ready to use them.
        private var seenImages: [Anchoring: UUID] = [:]
        private var startedAt = Date()
        private var cardImages = Set<ARReferenceImage>()
        private var codeImage: ARReferenceImage?
        private let tracker: QRTracker?
        private var placementTimer: Timer?
        private var loadTask: Task<Void, Never>?

        /// Flat art hangs on walls and windows; a 3D model always stands on a table or floor.
        private var vertical: Bool { model.placement.isVertical && !model.content.isModel }
        private var alignment: ARRaycastQuery.TargetAlignment { vertical ? .vertical : .horizontal }
        private var hasReferenceImages: Bool { !cardImages.isEmpty || codeImage != nil }

        init(model: ExperienceModel) {
            self.model = model
            tracker = model.visit.code.map { QRTracker(expectedCode: $0) }
        }

        func attach(to view: ARView) {
            arView = view
            view.session.delegate = self
            view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap(_:))))
            runSession()
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

        private func runSession() {
            guard let arView else { return }
            var images = cardImages
            if let codeImage { images.insert(codeImage) }
            let config = ARWorldTrackingConfiguration()
            config.planeDetection = vertical ? [.vertical] : [.horizontal]
            config.environmentTexturing = .automatic
            config.detectionImages = images
            // Tracked (not just detected) so content follows the card when it moves.
            config.maximumNumberOfTrackedImages = min(2, images.count)
            config.automaticImageScaleEstimationEnabled = codeImage != nil
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
                config.frameSemantics.insert(.personSegmentationWithDepth)
            }
            // Keep tracking and anchors when adding reference images mid-session.
            arView.session.run(config, options: [])
        }

        // MARK: Cards and the printed code

        private func loadReferenceImages() {
            let cards = model.tableCards
            guard !cards.isEmpty else { return }
            Task { [weak self] in
                let images = await ReferenceImageLoader.load(cards)
                guard let self, !images.isEmpty else { return }
                self.cardImages = images
                self.startedAt = Date()
                self.runSession()
            }
        }

        private func codeImageReady(_ image: ARReferenceImage) {
            codeImage = image
            runSession()
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
                    self.useBestSeenImage()
                } catch {
                    // Forget the key so "Try again" rebuilds instead of being skipped as already loaded.
                    self?.loadedKey = nil
                    self?.model.phase = .failed("This couldn't be opened here. Ask your server about it instead.")
                }
            }
        }

        /// Puts the content and marker on an anchor. `facing` orients flat content on a surface
        /// (wall normal, or toward the guest). On a tracked image everything stands on the print
        /// in its own frame (+Z is the print's bottom edge, toward the guest), so it travels with it.
        private func place(at anchorEntity: AnchorEntity, facing: SIMD3<Float>?, as kind: Anchoring) {
            guard let arView, let content, let marker else { return }
            anchor?.removeFromParent()
            content.removeFromParent()
            marker.removeFromParent()
            anchorEntity.addChild(content)
            anchorEntity.addChild(marker)

            let upright = simd_quatf(angle: 0, axis: [0, 1, 0])
            if model.modelFile != nil {
                content.position = .zero
                marker.orientation = upright
                marker.position = [0, 0.001, 0]
            } else if kind.tracksAnImage {
                content.orientation = upright
                content.position = [0, ARContentBuilder.tableLift + contentSize.y / 2, 0]
                // A wall piece's ring was built upright; lay it flat under the card instead.
                marker.orientation = vertical ? simd_quatf(angle: -.pi / 2, axis: [1, 0, 0]) : upright
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
                marker.orientation = upright
                marker.position = [0, 0.001, 0]
            }

            arView.scene.addAnchor(anchorEntity)
            anchor = anchorEntity
            if model.modelFile != nil { ModelPreparation.playBakedAnimations(in: content) }
            anchoring = kind

            if !UIAccessibility.isReduceMotionEnabled, model.phase == .finding {
                let final = content.transform
                content.transform.scale = SIMD3(repeating: 0.01)
                content.move(to: final, relativeTo: anchorEntity, duration: 0.45, timingFunction: .easeOut)
            }
            UIImpactFeedbackGenerator(style: kind.tracksAnImage ? .medium : .light).impactOccurred()
            model.phase = .placed(onCard: kind.tracksAnImage)
        }

        /// Stands the content on the best print ARKit has seen so far, if that beats the current anchor.
        private func useBestSeenImage() {
            guard content != nil, let best = seenImages.keys.max(), best > anchoring, let identifier = seenImages[best] else { return }
            place(at: AnchorEntity(.anchor(identifier: identifier)), facing: nil, as: best)
        }

        private var cameraPosition: SIMD3<Float> {
            arView?.cameraTransform.translation ?? .zero
        }

        private func place(hit: ARRaycastResult) {
            let position = SIMD3<Float>(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
            if model.modelFile != nil {
                place(at: AnchorEntity(world: hit.worldTransform), facing: nil, as: .surface)
            } else if vertical {
                let normal = ARMath.outwardNormal(hit: hit.worldTransform, camera: cameraPosition)
                place(at: AnchorEntity(world: position), facing: normal, as: .surface)
            } else {
                place(at: AnchorEntity(world: position), facing: cameraPosition - position, as: .surface)
            }
        }

        /// No print recognised after a few seconds: use the surface under the screen centre.
        /// A card or code seen later still takes over.
        private func tryPlaneFallback() {
            guard let arView, content != nil, anchor == nil else { return }
            let wait: TimeInterval = hasReferenceImages || tracker != nil ? 4 : 1
            guard Date().timeIntervalSince(startedAt) > wait else { return }
            let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY * (vertical ? 0.9 : 1.2))
            guard let hit = arView.raycast(from: center, allowing: .estimatedPlane, alignment: alignment).first else { return }
            place(hit: hit)
        }

        /// Tapping a surface moves the content there. Off a card it stops following that card;
        /// the guest asked for it, and pointing at the card again doesn't yank it back.
        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let arView, content != nil else { return }
            let point = gesture.location(in: arView)
            guard let hit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: alignment).first else { return }
            seenImages.removeAll()
            place(hit: hit)
        }

        // MARK: ARSessionDelegate

        nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
            MainActor.assumeIsolated {
                // Only worth capturing the code while nothing registered is anchoring the content.
                guard anchoring < .capturedCode, let arView, let tracker else { return }
                tracker.consider(frame: frame, in: arView) { [weak self] image, _ in
                    self?.codeImageReady(image)
                }
            }
        }

        nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            let images = anchors.compactMap { $0 as? ARImageAnchor }
            guard !images.isEmpty else { return }
            let found = images.map { ($0.identifier, $0.referenceImage.name) }
            MainActor.assumeIsolated {
                for (identifier, name) in found {
                    let kind: Anchoring
                    if let name, name.hasPrefix(QRTracker.namePrefix) { kind = .capturedCode }
                    else if let name, name == model.visit.spot?.tableCardId { kind = .spotCard }
                    else { kind = .venueCard }
                    if seenImages[kind] == nil { seenImages[kind] = identifier }
                }
                useBestSeenImage()
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
    /// Downloads card artwork and keeps only images ARKit can actually track;
    /// one bad image would otherwise fail the whole session. Each image is named by card id.
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
