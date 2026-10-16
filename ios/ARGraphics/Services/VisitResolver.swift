import Foundation

/// Everything the guest's visit needs, captured once the code resolves.
struct Visit: Hashable, Identifiable {
    let id = UUID()
    let venue: PublicVenueSummary
    /// Where the scanned code is placed, like "Table 6". Nil for venue links.
    let spot: PublicSpot?
    /// The scanned code, sent with claims so the owner sees which spot drove the redemption.
    let code: String?
    /// The display this code points at, or nil to let the guest pick.
    let display: PublicDisplay?
    let displays: [PublicDisplay]
    let tableCards: [PublicTableCard]

    init(scan: ScanResult, code: String) {
        venue = scan.venue
        spot = scan.spot
        self.code = code
        display = scan.display
        displays = scan.displays
        tableCards = scan.tableCards
    }

    init(venue: PublicVenue) {
        self.venue = venue.venue
        spot = nil
        code = nil
        display = nil
        displays = venue.displays
        tableCards = venue.tableCards
    }
}

/// Turns a scanned or opened link into a Visit. Drives the scan landing's states.
@Observable
@MainActor
final class VisitResolver {
    enum State: Equatable {
        case idle
        case resolving
        case resolved(Visit)
        case failed(String)
    }

    private(set) var state: State = .idle
    private let api: VisitorAPI?
    private let identity: VisitorIdentity
    private var task: Task<Void, Never>?

    init(api: VisitorAPI?, identity: VisitorIdentity) {
        self.api = api
        self.identity = identity
    }

    var isBusy: Bool { state == .resolving }

    /// Starts resolving and calls `completion` on success. A newer link cancels an older one.
    func open(_ link: ScanLink, completion: @escaping @MainActor (Visit) async -> Void) {
        task?.cancel()
        state = .resolving
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let visit = try await self.resolve(link)
                guard !Task.isCancelled else { return }
                self.state = .resolved(visit)
                await completion(visit)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.state = .failed(Self.message(for: error, link: link))
            }
        }
    }

    func reset() {
        task?.cancel()
        state = .idle
    }

    func resolve(_ link: ScanLink) async throws -> Visit {
        guard let api else { throw APIError.notConfigured }
        let visitorId = identity.id
        switch link {
        case .code(let code):
            return Visit(scan: try await api.scan(code: code, visitorId: visitorId), code: code)
        case .venue(let slug):
            return Visit(venue: try await api.venue(slug: slug))
        case .typed(let text):
            do {
                return Visit(scan: try await api.scan(code: text, visitorId: visitorId), code: text)
            } catch APIError.notFound {
                // Not a placed code; it may be a venue slug printed on older table tents.
                return Visit(venue: try await api.venue(slug: text))
            }
        }
    }

    static func message(for error: Error, link: ScanLink) -> String {
        switch (error as? APIError, link) {
        case (.notFound?, .venue):
            return "We couldn't find that spot. Check the code and try again."
        case (.notFound?, _), (.invalidRequest?, _):
            return "That code isn't active anymore. Ask your server for a fresh one."
        case (let apiError?, _):
            return apiError.errorDescription ?? APIError.offline.localizedDescription
        default:
            return APIError.offline.localizedDescription
        }
    }
}
