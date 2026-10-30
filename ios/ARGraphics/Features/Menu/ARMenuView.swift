import ARKit
import RealityKit
import SwiftUI

#if targetEnvironment(simulator)
/// See ARExperienceView: the Simulator has no ARKit, so the list screen is used instead.
struct ARMenuView: View {
    let model: MenuExperienceModel
    let api: VisitorAPI?
    var body: some View { Color.clear }
}
#else
/// The code's menu, in the room. Miniatures of every item stand in an arc on what the venue
/// chose for this code (the printed QR code or a registered card design, tracked as an ARKit
/// image so the menu follows the card when it moves; or the table) with a floating name and
/// price. Tap one and it comes up to real size in the middle; tap elsewhere to put it back.
struct ARMenuView: UIViewRepresentable {
    let model: MenuExperienceModel
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
        context.coordinator.itemsChanged(model.items)
        context.coordinator.selectionChanged(model.selectedId)
    }

    static func dismantleUIView(_ view: ARView, coordinator: Coordinator) {
        coordinator.teardown()
    }

    /// One miniature in the scene.
    private struct Placed {
        let root: Entity
        let content: ModelEntity
        let label: ModelEntity
        /// Multiplier that takes the miniature to real size.
        let fullScale: Float
        let facesCamera: Bool
    }

    @MainActor
    final class Coordinator: NSObject, ARSessionDelegate {
        private let model: MenuExperienceModel
        private let api: VisitorAPI?
        private weak var arView: ARView?
        private var anchor: AnchorEntity?
        private var onImage = false
        /// Width of what the menu stands round: the code, the card, or a guess.
        private var codeWidth: Float = 0.06
        private var referenceImages = Set<ARReferenceImage>()
        private var imagesReadyAt: Date?
        private var marker: ModelEntity?
        private var placed: [String: Placed] = [:]
        private var building: Set<String> = []
        private var startedAt = Date()
        private var fallbackTimer: Timer?
        private var selectedId: String?

        private var expectsImage: Bool { model.visit.tracksCode || !model.visit.trackedCards.isEmpty }

        init(model: MenuExperienceModel, api: VisitorAPI?) {
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
            fallbackTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tryPlaneFallback() }
            }
        }

        func teardown() {
            fallbackTimer?.invalidate()
            arView?.session.pause()
            model.snapshotProvider = nil
        }

        private func runSession() {
            guard let arView else { return }
            let config = ARWorldTrackingConfiguration()
            config.planeDetection = [.horizontal, .vertical]
            config.environmentTexturing = .automatic
            config.detectionImages = referenceImages
            // Tracked (not just detected) so the menu follows the print when it moves.
            config.maximumNumberOfTrackedImages = min(1, referenceImages.count)
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
                config.frameSemantics.insert(.personSegmentationWithDepth)
            }
            // Keep tracking and anchors when adding reference images mid-session.
            arView.session.run(config, options: [])
        }

        // MARK: Items

        func itemsChanged(_ items: [MenuItem]) {
            for item in items where item.isReady && placed[item.id] == nil && !building.contains(item.id) {
                building.insert(item.id)
                Task { [weak self] in await self?.build(item) }
            }
        }

        private func build(_ item: MenuItem) async {
            defer { building.remove(item.id) }
            do {
                let content: ModelEntity
                var height = ARMenuLayout.miniatureHeight
                let fullScale: Float
                let facesCamera: Bool
                if let file = item.modelFile {
                    content = ModelPreparation.normalizedContainer(for: try await Entity(contentsOf: file), height: height)
                    fullScale = (item.display.modelHeight ?? ModelPreparation.itemHeight) / height
                    facesCamera = false
                } else if let image = item.image {
                    let framed: Bool
                    if case .panel(_, let isFramed) = item.content { framed = isFramed } else { framed = false }
                    let full = ARMath.panelSize(imageSize: image.size, placement: .table, framed: framed)
                    let width: Float = 0.085
                    let size = SIMD2<Float>(width, width * full.y / full.x)
                    content = try await ARContentBuilder.panel(image: image, framed: framed, size: size)
                    // Panels are centred on their origin; stand them on the surface like a card.
                    content.position.y = size.y / 2 + 0.012
                    height = size.y + 0.012
                    fullScale = full.x / size.x
                    facesCamera = true
                } else {
                    return
                }
                let (label, labelSize) = try await ARContentBuilder.label(name: item.display.title, price: item.display.price)
                label.position = [0, height + 0.02 + labelSize.y / 2, 0]
                let root = Entity()
                root.name = "item:\(item.id)"
                root.addChild(content)
                root.addChild(label)
                placed[item.id] = Placed(root: root, content: content, label: label, fullScale: fullScale, facesCamera: facesCamera)
                if anchor != nil { layout(animated: true) }
            } catch {
                // Leave it off the arc; the others still show.
            }
        }

        /// Puts every built miniature at its arc position for the current item order.
        private func layout(animated: Bool) {
            guard let anchor else { return }
            let ids = model.items.map(\.id).filter { placed[$0] != nil }
            let positions = ARMenuLayout.positions(count: ids.count, codeWidth: codeWidth)
            for (id, position) in zip(ids, positions) {
                guard let entry = placed[id] else { continue }
                if entry.root.parent == nil {
                    anchor.addChild(entry.root)
                    entry.root.position = position
                    if model.selectedId != nil {
                        entry.root.scale = SIMD3(repeating: 0.55)
                        entry.root.components.set(OpacityComponent(opacity: 0.3))
                    } else if animated, !UIAccessibility.isReduceMotionEnabled {
                        entry.root.scale = SIMD3(repeating: 0.01)
                        entry.root.move(to: Transform(scale: .one, rotation: entry.root.orientation, translation: position),
                                        relativeTo: anchor, duration: 0.4, timingFunction: .easeOut)
                    }
                    ModelPreparation.playBakedAnimations(in: entry.content)
                } else if id != selectedId {
                    entry.root.move(to: Transform(scale: entry.root.scale, rotation: entry.root.orientation, translation: position),
                                    relativeTo: anchor, duration: animated ? 0.3 : 0, timingFunction: .easeInOut)
                }
            }
        }

        // MARK: Selection

        func selectionChanged(_ id: String?) {
            guard id != selectedId else { return }
            selectedId = id
            guard let anchor else { return }
            let ids = model.items.map(\.id).filter { placed[$0] != nil }
            let positions = ARMenuLayout.positions(count: ids.count, codeWidth: codeWidth)
            let duration: TimeInterval = UIAccessibility.isReduceMotionEnabled ? 0 : 0.45
            for (itemId, home) in zip(ids, positions) {
                guard let entry = placed[itemId] else { continue }
                let target: Transform
                let opacity: Float
                if itemId == id {
                    // Up onto the code, at real size, label off (the screen shows the price chip).
                    target = Transform(scale: SIMD3(repeating: entry.fullScale), rotation: entry.root.orientation, translation: .zero)
                    opacity = 1
                    entry.label.components.set(OpacityComponent(opacity: 0))
                } else {
                    target = Transform(scale: SIMD3(repeating: id == nil ? 1 : 0.55), rotation: entry.root.orientation, translation: home)
                    opacity = id == nil ? 1 : 0.3
                    entry.label.components.set(OpacityComponent(opacity: 1))
                }
                entry.root.components.set(OpacityComponent(opacity: opacity))
                entry.root.move(to: target, relativeTo: anchor, duration: duration, timingFunction: .easeInOut)
            }
            if let id, let title = model.items.first(where: { $0.id == id })?.display.title {
                UIAccessibility.post(notification: .announcement, argument: title)
            }
        }

        // MARK: Placement

        private var cameraPosition: SIMD3<Float> { arView?.cameraTransform.translation ?? .zero }

        /// Moves the whole menu onto `anchorEntity`: the tracked print, or a spot on a surface.
        /// `width` is what the arc stands round.
        private func place(on anchorEntity: AnchorEntity, width: Float, onImage image: Bool) {
            guard let arView else { return }
            codeWidth = width
            onImage = image
            anchor?.removeFromParent()
            arView.scene.addAnchor(anchorEntity)
            anchor = anchorEntity
            for entry in placed.values { entry.root.removeFromParent() }
            Task { [weak self] in
                guard let self else { return }
                if let ring = try? await ARContentBuilder.marker(diameter: max(0.12, width * 1.35), horizontal: true) {
                    self.marker?.removeFromParent()
                    ring.position = [0, 0.002, 0]
                    anchorEntity.addChild(ring)
                    self.marker = ring
                }
            }
            layout(animated: true)
            if let selected = model.selectedId { selectedId = nil; selectionChanged(selected) }
            UIImpactFeedbackGenerator(style: image ? .medium : .light).impactOccurred()
            model.phase = .placed(onCode: image)
        }

        /// Surface placement: straight away for surface codes; for a tracked print, only after
        /// it has had a fair chance to be seen. The print still takes over once it appears.
        private func tryPlaneFallback() {
            guard let arView, anchor == nil else { return }
            if expectsImage {
                guard let ready = imagesReadyAt, Date().timeIntervalSince(ready) > 3 else { return }
            } else {
                guard Date().timeIntervalSince(startedAt) > 1 else { return }
            }
            let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY * 1.15)
            guard let hit = arView.raycast(from: center, allowing: .estimatedPlane, alignment: .horizontal).first else { return }
            place(on: surfaceAnchor(hit: hit.worldTransform), width: model.visit.spot?.qrWidth ?? codeWidth, onImage: false)
        }

        private func surfaceAnchor(hit transform: simd_float4x4) -> AnchorEntity {
            let position = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
            let up = ARMath.outwardNormal(hit: transform, camera: cameraPosition)
            return AnchorEntity(world: ARMenuLayout.surfaceFrame(center: position, up: up, camera: cameraPosition))
        }

        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let arView else { return }
            let point = gesture.location(in: arView)
            if let tapped = arView.entity(at: point), let id = itemId(for: tapped) {
                model.select(id)
                return
            }
            if model.selectedId != nil {
                model.select(nil)
            } else if !onImage, let hit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: .any).first {
                place(on: surfaceAnchor(hit: hit.worldTransform), width: codeWidth, onImage: false)
            }
        }

        private func itemId(for entity: Entity) -> String? {
            var node: Entity? = entity
            while let current = node {
                if current.name.hasPrefix("item:") { return String(current.name.dropFirst(5)) }
                node = current.parent
            }
            return nil
        }

        // MARK: ARSessionDelegate

        nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
            MainActor.assumeIsolated { faceCamera() }
        }

        nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            guard let image = anchors.compactMap({ $0 as? ARImageAnchor }).first else { return }
            let identifier = image.identifier
            let width = Float(image.referenceImage.physicalSize.width)
            MainActor.assumeIsolated {
                guard !onImage else { return }
                place(on: AnchorEntity(.anchor(identifier: identifier)), width: width, onImage: true)
            }
        }

        /// Flat cards and labels always turn to the guest.
        private func faceCamera() {
            guard anchor != nil else { return }
            let camera = cameraPosition
            for entry in placed.values {
                let labelPosition = entry.label.position(relativeTo: nil)
                entry.label.setOrientation(ARMath.facing(camera - labelPosition), relativeTo: nil)
                if entry.facesCamera {
                    let contentPosition = entry.content.position(relativeTo: nil)
                    entry.content.setOrientation(ARMath.facing(camera - contentPosition), relativeTo: nil)
                }
            }
        }

        nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
            MainActor.assumeIsolated {
                model.phase = .failed((error as? ARError)?.code == .cameraUnauthorized
                    ? "Camera is off. Turn it on in Settings to see the menu in your space."
                    : "AR stopped. Move to a brighter spot and try again.")
            }
        }
    }
}
#endif
