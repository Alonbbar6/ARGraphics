import SwiftUI

@main
struct ARGraphicsApp: App {
    @State private var environment = AppEnvironment.live()

    var body: some Scene {
        WindowGroup {
            RootView(resolver: VisitResolver(api: environment.api, identity: environment.identity))
                .environment(environment)
                .preferredColorScheme(.dark)
                .tint(Palette.orchid)
        }
    }
}

/// Shared services. `api` is nil when the build has no API settings,
/// in which case screens explain that instead of failing silently.
@Observable
final class AppEnvironment {
    let api: VisitorAPI?
    let identity: VisitorIdentity
    let assets: AssetCache
    let images: ImageLoader

    init(api: VisitorAPI?, identity: VisitorIdentity = .shared, assets: AssetCache = .shared, images: ImageLoader = .shared) {
        self.api = api
        self.identity = identity
        self.assets = assets
        self.images = images
    }

    static func live() -> AppEnvironment {
        #if DEBUG
        // `-ARGraphicsDemo YES` runs on built-in sample data, for Simulator screenshots and design review.
        if UserDefaults.standard.bool(forKey: "ARGraphicsDemo") {
            return AppEnvironment(api: DemoAPI())
        }
        #endif
        return AppEnvironment(api: AppConfig.current.map { APIClient(config: $0) })
    }
}

enum Route: Hashable {
    /// The venue's live displays, for links that don't point at one display.
    case venue(Visit)
    case experience(Visit, PublicDisplay)
}

struct RootView: View {
    @State var resolver: VisitResolver
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScanScreen(resolver: resolver, isActive: path.isEmpty, onLink: open)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .venue(let visit):
                        VenueScreen(visit: visit) { path.append(.experience(visit, $0)) }
                    case .experience(let visit, let display):
                        ExperienceScreen(visit: visit, display: display) {
                            path.append(.venue(visit))
                        }
                    }
                }
        }
        .onOpenURL { url in
            // The system Camera app opens argraphics:// links (and verified https links) here.
            if let link = ScanLink.parse(url.absoluteString) { open(link) }
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            // Universal Links: https://<associated-domain>/s/{code}. Only the code is used.
            if let url = activity.webpageURL, let link = ScanLink.parse(url.absoluteString) { open(link) }
        }
        .onChange(of: path.isEmpty) { _, isEmpty in
            // Back on the scanner after a visit: clear the venue name and scan again.
            if isEmpty, case .resolved = resolver.state { resolver.reset() }
        }
        #if DEBUG
        .onAppear {
            // Simulator has no camera: `-ARGraphicsOpenURL https://x/s/<code>` acts like a scan.
            if let raw = UserDefaults.standard.string(forKey: "ARGraphicsOpenURL"), let link = ScanLink.parse(raw) {
                open(link)
            }
        }
        #endif
    }

    private func open(_ link: ScanLink) {
        path = []
        resolver.open(link) { visit in
            // The scan landing shows the venue name the moment the result arrives, then the
            // experience opens and loads its 3D model or artwork behind the same name.
            try? await Task.sleep(for: .milliseconds(350))
            guard case .resolved(let current) = resolver.state, current.id == visit.id else { return }
            if let display = visit.display {
                path = [.experience(visit, display)]
            } else {
                path = [.venue(visit)]
            }
        }
    }
}
