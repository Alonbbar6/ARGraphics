import ARKit
import AVFoundation
import SwiftUI

/// One miniature on the AR menu and whatever it has loaded so far.
struct MenuItem: Identifiable, Equatable {
    let display: PublicDisplay
    let content: ExperienceContent
    var modelFile: URL?
    var image: UIImage?
    var failed = false

    var id: String { display.id }
    var isReady: Bool { modelFile != nil || image != nil }
}

/// The whole code's menu in the guest's space: miniatures round the printed code, one of
/// them brought up to real size when tapped.
@Observable
@MainActor
final class MenuExperienceModel {
    enum Phase: Equatable {
        /// Looking for the printed code (or a surface) with the camera.
        case finding
        case placed(onCode: Bool)
        case failed(String)
    }

    let visit: Visit
    private(set) var items: [MenuItem]
    var phase: Phase = .finding
    private(set) var selectedId: String?
    /// Installed by the AR view.
    var snapshotProvider: ((@escaping (UIImage?) -> Void) -> Void)?

    init(visit: Visit) {
        self.visit = visit
        items = ARMenuLayout.menuDisplays(visit.displays).map { MenuItem(display: $0, content: ExperienceContent(display: $0)) }
    }

    /// The scanned code's payload, so the camera can confirm it's looking at the right print.
    var expectedCode: String? { visit.code }
    var selected: MenuItem? { items.first { $0.id == selectedId } }
    var readyCount: Int { items.filter(\.isReady).count }
    /// Displays left off the arc because there were too many for one table.
    var overflowCount: Int { visit.displays.count - items.count }

    /// Whether the menu can be shown in AR at all for this visit.
    static func canShow(_ visit: Visit, cameraStatus: AVAuthorizationStatus? = nil, arSupported: Bool? = nil) -> Bool {
        guard visit.display == nil, visit.code != nil, ARMenuLayout.menuDisplays(visit.displays).count > 1 else { return false }
        var supported = arSupported ?? ARWorldTrackingConfiguration.isSupported
        #if DEBUG
        if arSupported == nil, UserDefaults.standard.bool(forKey: "ARGraphicsForceARLayout") { supported = true }
        #endif
        guard supported else { return false }
        switch cameraStatus ?? AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted: return false
        default: return true
        }
    }

    /// Downloads every item's model or artwork, surfacing each one as it lands.
    func prepare(assets: AssetCache, images: ImageLoader) async {
        await withTaskGroup(of: (String, URL?, UIImage?, Bool).self) { group in
            for item in items where !item.isReady {
                group.addTask {
                    do {
                        switch item.content {
                        case .model(let remote): return (item.id, try await assets.localFile(for: remote), nil, false)
                        case .panel(let remote, _): return (item.id, nil, try await images.image(for: remote), false)
                        case .none: return (item.id, nil, nil, true)
                        }
                    } catch {
                        return (item.id, nil, nil, true)
                    }
                }
            }
            for await (id, file, image, failed) in group {
                guard let index = items.firstIndex(where: { $0.id == id }) else { continue }
                items[index].modelFile = file
                items[index].image = image
                items[index].failed = failed
            }
        }
        if items.allSatisfy(\.failed) {
            phase = .failed("Nothing on the menu could be opened here. Ask your server instead.")
        }
    }

    func select(_ id: String?) {
        guard selectedId != id else { return }
        selectedId = id
        UIImpactFeedbackGenerator(style: id == nil ? .light : .medium).impactOccurred()
    }

    func snapshot() async -> UIImage? {
        guard let snapshotProvider else { return nil }
        return await withCheckedContinuation { continuation in
            snapshotProvider { continuation.resume(returning: $0) }
        }
    }
}
