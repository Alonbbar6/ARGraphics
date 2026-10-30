import ARKit
import RealityKit
import SwiftUI

#if targetEnvironment(simulator)
/// The Simulator's RealityKit lacks ARKit anchoring symbols, and ARKit reports itself
/// unsupported there, so ExperienceModel always picks the flat page instead.
struct ARExperienceView: View {
    let model: ExperienceModel
    let api: VisitorAPI?
    var body: some View { Color.clear }
}
#else
/// Live AR. Content stands on what the venue chose for this code: the printed code itself or
/// a registered card design, both tracked as ARKit images so the content follows the card
/// when a guest picks it up; or the table or wall (menu items on the nearest table, art flat
/// on a wall or window). While a tracked print hasn't been seen yet, the content waits on the
/// surface in front of the guest and jumps onto the print as soon as it appears. A Coral
/// marker sits under whatever was placed. Tap a surface to move it there.
struct ARExperienceView: UIViewRepresentable {
    let model: ExperienceModel
    let api: VisitorAPI?

    func makeCoordinator() -> Coordinator { Coordinator(model: model, api: api) }

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
        private let api: VisitorAPI?
        private weak var arView: ARView?
        private var loadedKey: String?
        private var content: ModelEntity?
        private var marker: ModelEntity?
        private var contentSize: SIMD2<Float> = [0.2, 0.2]
        private var anchor: AnchorEntity?
        private var onImage = false
        /// The tracked print's anchor, if ARKit found it before the content was ready.
        private var pendingImageAnchor: UUID?
        private var referenceImages = Set<ARReferenceImage>()
        private var imagesReadyAt: Date?
        private var startedAt = Date()
        private var placementTimer: Timer?
        private var loadTask: Task<Void, Never>?

        /// Flat art hangs on walls and windows; a 3D model always stands on a table or floor.
        private var vertical: Bool { model.placement.isVertical && !model.content.isModel }
        private var alignment: ARRaycastQuery.TargetAlignment { vertical ? .vertical : .horizontal }
        /// Whether this code is meant to stand on a print (the code or a card) rather than a surface.
        private var expectsImage: Bool { model.visit.tracksCode || !model.visit.trackedCards.isEmpty }

        init(model: ExperienceModel, api: VisitorAPI?) {
            self.model = model
            self.api = api
        }

        func attach(to view: ARView) {
            arView = view
            view.session.delegate = self
            view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap(_:))))
            runSession()
            startedAt = Date()
            if expectsImage {
                Task { [weak self] in
                    guard let self else { return }
                    let images = await ReferenceImageLoader.load(for: self.model.visit, api: self.api)
                    guard !images.isEmpty else { return }
                    self.referenceImages = images
                    self.imagesReadyAt = Date()
                    self.runSession()
                }
            }

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
            let config = ARWorldTrackingConfiguration()
            config.planeDetection = vertical ? [.vertical] : [.horizontal]
            config.environmentTexturing = .automatic
            config.detectionImages = referenceImages
            // Tracked (not just detected) so content follows the print when it moves.
            config.maximumNumberOfTrackedImages = min(1, referenceImages.count)
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
                config.frameSemantics.insert(.personSegmentationWithDepth)
            }
            // Keep tracking and anchors when adding reference images mid-session.
            arView.session.run(config, options: [])
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
                    if let pending = self.pendingImageAnchor { self.placeOnImage(pending) }
                } catch {
                    // Forget the key so "Try again" rebuilds instead of being skipped as already loaded.
                    self?.loadedKey = nil
                    self?.model.phase = .failed("This couldn't be opened here. Ask your server about it instead.")
                }
            }
        }

        /// Puts the content and marker on an anchor. `facing` orients flat content on a surface
        /// (wall normal, or toward the guest). On a tracked print everything stands on it in the
        /// print's own frame (+Z is its bottom edge, toward the guest), so it travels with it.
        private func place(at anchorEntity: AnchorEntity, facing: SIMD3<Float>?, onImage image: Bool) {
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
            } else if image {
                content.orientation = upright
                content.position = [0, ARContentBuilder.tableLift + contentSize.y / 2, 0]
                // A wall piece's ring was built upright; lay it flat under the print instead.
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
            onImage = image

            if !UIAccessibility.isReduceMotionEnabled, model.phase == .finding {
                let final = content.transform
                content.transform.scale = SIMD3(repeating: 0.01)
                content.move(to: final, relativeTo: anchorEntity, duration: 0.45, timingFunction: .easeOut)
            }
            UIImpactFeedbackGenerator(style: image ? .medium : .light).impactOccurred()
            model.phase = .placed(onCard: image)
        }

        private func placeOnImage(_ identifier: UUID) {
            guard !onImage, content != nil else { return }
            place(at: AnchorEntity(.anchor(identifier: identifier)), facing: nil, onImage: true)
        }

        private var cameraPosition: SIMD3<Float> {
            arView?.cameraTransform.translation ?? .zero
        }

        private func place(hit: ARRaycastResult) {
            let position = SIMD3<Float>(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
            if model.modelFile != nil {
                place(at: AnchorEntity(world: hit.worldTransform), facing: nil, onImage: false)
            } else if vertical {
                let normal = ARMath.outwardNormal(hit: hit.worldTransform, camera: cameraPosition)
                place(at: AnchorEntity(world: position), facing: normal, onImage: false)
            } else {
                place(at: AnchorEntity(world: position), facing: cameraPosition - position, onImage: false)
            }
        }

        /// Surface placement: straight away for surface codes; for a tracked print, only after
        /// the print has had a fair chance to be seen, so the guest isn't left with nothing.
        private func tryPlaneFallback() {
            guard let arView, content != nil, anchor == nil else { return }
            if expectsImage {
                guard let ready = imagesReadyAt, Date().timeIntervalSince(ready) > 3 else { return }
            } else {
                guard Date().timeIntervalSince(startedAt) > 1 else { return }
            }
            let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY * (vertical ? 0.9 : 1.2))
            guard let hit = arView.raycast(from: center, allowing: .estimatedPlane, alignment: alignment).first else { return }
            place(hit: hit)
        }

        /// Tapping a surface moves the content there. Off a print it stops following that print;
        /// the guest asked for it, and pointing at the print again doesn't yank it back.
        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let arView, content != nil else { return }
            let point = gesture.location(in: arView)
            guard let hit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: alignment).first else { return }
            pendingImageAnchor = nil
            place(hit: hit)
        }

        // MARK: ARSessionDelegate

        nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            guard let image = anchors.compactMap({ $0 as? ARImageAnchor }).first else { return }
            let identifier = image.identifier
            MainActor.assumeIsolated {
                guard !onImage else { return }
                pendingImageAnchor = identifier
                placeOnImage(identifier)
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
    /// Reference image names starting with this are the printed code itself.
    static let codeNamePrefix = "qr:"

    /// The printed code as an ARKit tracked image: the server's PNG (the dashboard's exact
    /// render) at the width the venue measured on the print. Nil if ARKit can't track it.
    static func code(_ code: String, api: VisitorAPI?, width: Float) async -> ARReferenceImage? {
        guard let api, width > 0.005, let data = try? await api.codeImage(code: code),
              let cgImage = UIImage(data: data)?.cgImage else { return nil }
        let image = ARReferenceImage(cgImage, orientation: .up, physicalWidth: CGFloat(width))
        image.name = codeNamePrefix + code
        let valid = await withCheckedContinuation { continuation in
            image.validate { continuation.resume(returning: $0 == nil) }
        }
        return valid ? image : nil
    }

    /// Everything to track for a visit: the printed code and/or the chosen cards.
    static func load(for visit: Visit, api: VisitorAPI?) async -> Set<ARReferenceImage> {
        async let code = visit.tracksCode ? Self.code(visit.code!, api: api, width: visit.spot?.qrWidth ?? 0.04) : nil
        async let cards = load(visit.trackedCards)
        var images = await cards
        if let code = await code { images.insert(code) }
        return images
    }

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
