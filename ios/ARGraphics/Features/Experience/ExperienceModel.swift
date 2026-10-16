import ARKit
import AVFoundation
import RealityKit
import SwiftUI

/// What appears in the guest's space for a display.
enum ExperienceContent: Equatable {
    /// A USDZ model standing on the table (menu items).
    case model(URL)
    /// Flat artwork: a framed piece on a wall, or a card floating over the table.
    case panel(URL, framed: Bool)
    /// Nothing to place; the card is the experience.
    case none

    init(display: PublicDisplay) {
        switch display.type {
        case .menuItem:
            if let model = display.modelURL {
                self = .model(model)
            } else if let image = display.mediaURL ?? display.thumbnailURL {
                self = .panel(image, framed: false)
            } else {
                self = .none
            }
        case .artPiece:
            if let image = display.mediaURL ?? display.thumbnailURL {
                self = .panel(image, framed: true)
            } else {
                self = .none
            }
        case .eventTeaser, .promoOffer, .unknown:
            self = display.mediaURL.map { .panel($0, framed: false) } ?? .none
        }
    }
}

/// Which card the bottom sheet shows.
enum CardKind: Equatable {
    case artist(PublicArtistCredit)
    case offer(PublicOffer)
    case info

    init(display: PublicDisplay) {
        if display.type == .artPiece, let artist = display.artist {
            self = .artist(artist)
        } else if let offer = display.offer {
            self = .offer(offer)
        } else {
            self = .info
        }
    }
}

@Observable
@MainActor
final class ExperienceModel {
    enum Mode: Equatable {
        case ar
        /// A normal page: 3D turntable or artwork plus the card.
        case flat(FlatReason)
    }

    enum FlatReason: Equatable {
        case cameraOff
        case arUnsupported
        case noMedia
    }

    enum Phase: Equatable {
        case loading
        case finding
        case placed(onCard: Bool)
        case failed(String)
    }

    enum ClaimState: Equatable {
        case idle
        case claiming
        case claimed(Claim)
        case ended
        case failed(String)
    }

    let visit: Visit
    let display: PublicDisplay
    let content: ExperienceContent
    let card: CardKind
    private(set) var mode: Mode
    var phase: Phase = .loading
    private(set) var modelFile: URL?
    private(set) var panelImage: UIImage?
    var claimState: ClaimState = .idle

    /// Installed by whichever 3D view is on screen.
    var snapshotProvider: ((@escaping (UIImage?) -> Void) -> Void)?

    init(visit: Visit, display: PublicDisplay, cameraStatus: AVAuthorizationStatus? = nil, arSupported: Bool? = nil) {
        self.visit = visit
        self.display = display
        content = ExperienceContent(display: display)
        card = CardKind(display: display)
        var supported = arSupported ?? ARWorldTrackingConfiguration.isSupported
        #if DEBUG
        // Design-review hook: `-ARGraphicsForceARLayout YES` shows the AR overlay (sheet, reticle)
        // in the Simulator, over a blank camera.
        if arSupported == nil, UserDefaults.standard.bool(forKey: "ARGraphicsForceARLayout") { supported = true }
        #endif
        if content == .none {
            mode = .flat(.noMedia)
        } else if !supported {
            mode = .flat(.arUnsupported)
        } else {
            switch cameraStatus ?? AVCaptureDevice.authorizationStatus(for: .video) {
            case .denied, .restricted: mode = .flat(.cameraOff)
            default: mode = .ar
            }
        }
    }

    var placement: Placement { display.placement }

    /// Table cards only help content that sits on the table.
    var tableCards: [PublicTableCard] { placement.isVertical ? [] : visit.tableCards }

    func prepare(assets: AssetCache, images: ImageLoader) async {
        guard modelFile == nil, panelImage == nil else { return }
        phase = .loading
        do {
            switch content {
            case .model(let remote):
                modelFile = try await assets.localFile(for: remote)
            case .panel(let remote, _):
                panelImage = try await images.image(for: remote)
            case .none:
                break
            }
            phase = mode == .ar ? .finding : .placed(onCard: false)
        } catch {
            phase = .failed((error as? LocalizedError)?.errorDescription ?? AssetError.download.localizedDescription)
        }
    }

    func retry(assets: AssetCache, images: ImageLoader) async {
        modelFile = nil
        panelImage = nil
        await prepare(assets: assets, images: images)
    }

    func cameraDenied() {
        mode = .flat(.cameraOff)
        if modelFile != nil || panelImage != nil { phase = .placed(onCard: false) }
    }

    func snapshot() async -> UIImage? {
        if let snapshotProvider {
            return await withCheckedContinuation { continuation in
                snapshotProvider { continuation.resume(returning: $0) }
            }
        }
        // Flat artwork pages share the artwork itself.
        return panelImage
    }

    // MARK: Claims

    func claim(api: VisitorAPI?, visitorId: String) async {
        guard let api else {
            claimState = .failed(APIError.notConfigured.localizedDescription)
            return
        }
        if case .claiming = claimState { return }
        claimState = .claiming
        do {
            let outcome = try await api.claim(displayId: display.id, visitorId: visitorId, code: visit.code)
            claimState = .claimed(outcome.claim)
        } catch APIError.gone {
            claimState = .ended
        } catch APIError.notFound {
            claimState = .failed("This offer isn't available right now. Ask your server about it.")
        } catch {
            claimState = .failed((error as? LocalizedError)?.errorDescription ?? APIError.offline.localizedDescription)
        }
    }
}

enum ModelPreparation {
    /// Real-world height for a served dish or drink, so every generated model reads at table scale.
    static let itemHeight: Float = 0.16

    /// Wraps a loaded USDZ so it stands on its base at a consistent size, centered on the anchor,
    /// with a collision box for the rotate / pinch gestures.
    static func normalizedContainer(for entity: Entity, height: Float = itemHeight) -> ModelEntity {
        let container = ModelEntity()
        container.addChild(entity)

        let bounds = entity.visualBounds(relativeTo: container)
        let reference = bounds.extents.y > 0.0001 ? bounds.extents.y : max(bounds.extents.x, bounds.extents.z)
        if reference > 0.0001 {
            entity.scale *= SIMD3(repeating: height / reference)
        }
        let scaled = entity.visualBounds(relativeTo: container)
        entity.position += SIMD3(-scaled.center.x, -scaled.min.y, -scaled.center.z)

        let extents = entity.visualBounds(relativeTo: container).extents
        container.collision = CollisionComponent(
            shapes: [ShapeResource.generateBox(size: extents).offsetBy(translation: [0, extents.y / 2, 0])]
        )
        addGroundingShadow(to: entity)
        return container
    }

    private static func addGroundingShadow(to entity: Entity) {
        if entity.components.has(ModelComponent.self) {
            entity.components.set(GroundingShadowComponent(castsShadow: true))
        }
        for child in entity.children { addGroundingShadow(to: child) }
    }
}
