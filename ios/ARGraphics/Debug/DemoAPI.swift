#if DEBUG
import UIKit

/// Built-in sample data for Simulator screenshots and design review. Debug builds only.
/// Launch with `-ARGraphicsDemo YES -ARGraphicsOpenURL https://x/s/<code>`:
/// `demooffer` (promo offer), `demoart1` (art piece), `demomenu` (menu item),
/// `demoevent` (event teaser), anything else (pick from the list).
struct DemoAPI: VisitorAPI {
    private static let venue = PublicVenueSummary(
        slug: "casa-marisol", name: "Casa Marisol", kind: .venue,
        neighborhood: "Little Havana", bio: "Sixty seats, a back room bar, and birria on Tuesdays."
    )

    private static func artwork(_ name: String, colors: [UIColor]) -> String? {
        let url = FileManager.default.temporaryDirectory.appending(path: "demo-\(name).png")
        if !FileManager.default.fileExists(atPath: url.path) {
            let size = CGSize(width: 800, height: 1000)
            let image = UIGraphicsImageRenderer(size: size).image { context in
                let cg = colors.map(\.cgColor) as CFArray
                if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: cg, locations: nil) {
                    context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
                }
                UIColor(hex: 0xFDE68A, alpha: 0.9).setFill()
                context.cgContext.fillEllipse(in: CGRect(x: 420, y: 120, width: 260, height: 260))
            }
            try? image.pngData()?.write(to: url)
        }
        return url.absoluteString
    }

    private static var displays: [PublicDisplay] {
        let now = Date()
        return [
            PublicDisplay(
                id: "demo-offer", type: .promoOffer, placement: .table,
                title: "Free agua fresca", description: "With any birria tower.",
                mediaUrl: nil, thumbnailUrl: nil, modelUsdzUrl: nil, modelGlbUrl: nil, price: nil,
                offer: PublicOffer(title: "Free agua fresca with any birria tower",
                                   details: "Show this at the bar or to your server. One per guest.",
                                   endsAt: now.addingTimeInterval(6130)),
                eventStartsAt: nil, artist: nil
            ),
            PublicDisplay(
                id: "demo-art", type: .artPiece, placement: .wall,
                title: "Night Bloom", description: "This one blooms only after dark, only on this wall.",
                mediaUrl: artwork("art", colors: [UIColor(hex: 0x2A1B5E), UIColor(hex: 0xA855F7), UIColor(hex: 0xF43F5E)]),
                thumbnailUrl: nil, modelUsdzUrl: nil, modelGlbUrl: nil, price: nil, offer: nil, eventStartsAt: nil,
                artist: PublicArtistCredit(name: "Ana Ruiz", slug: "ana-ruiz",
                                           bio: "Ana paints florals on the walls of places she eats in Little Havana.")
            ),
            PublicDisplay(
                id: "demo-menu", type: .menuItem, placement: .table,
                title: "Tuesday Birria Tower", description: "Three tiers of birria tacos with consomé for dipping.",
                mediaUrl: artwork("menu", colors: [UIColor(hex: 0xF43F5E), UIColor(hex: 0xFB923C), UIColor(hex: 0xFDE68A)]),
                thumbnailUrl: nil, modelUsdzUrl: nil, modelGlbUrl: nil, price: "$14", offer: nil,
                eventStartsAt: nil, artist: nil
            ),
            PublicDisplay(
                id: "demo-event", type: .eventTeaser, placement: .poster,
                title: "Cumbia Thursdays", description: "Live band from 9. No cover before 10.",
                mediaUrl: nil, thumbnailUrl: nil, modelUsdzUrl: nil, modelGlbUrl: nil, price: nil, offer: nil,
                eventStartsAt: now.addingTimeInterval(86_400 * 2), artist: nil
            ),
        ]
    }

    func scan(code: String, visitorId: String) async throws -> ScanResult {
        try await Task.sleep(for: .milliseconds(300))
        let all = Self.displays
        let pick: PublicDisplay? = switch code {
        case "demooffer": all[0]
        case "demoart1": all[1]
        case "demomenu": all[2]
        case "demoevent": all[3]
        default: nil
        }
        return ScanResult(venue: Self.venue, spot: PublicSpot(label: "Table 6", placement: .table),
                          display: pick, displays: all, tableCards: [])
    }

    func venue(slug: String) async throws -> PublicVenue {
        PublicVenue(venue: Self.venue, displays: Self.displays, tableCards: [])
    }

    func claim(displayId: String, visitorId: String, code: String?) async throws -> ClaimOutcome {
        try await Task.sleep(for: .milliseconds(400))
        let now = Date()
        return ClaimOutcome(claim: Claim(confirmationCode: "BX-4821", offerTitle: "Free agua fresca",
                                         venueName: Self.venue.name, spotLabel: "Table 6",
                                         claimedAt: now.addingTimeInterval(-8), expiresAt: now.addingTimeInterval(892)),
                            isNew: true)
    }

    func nearby(slug: String) async throws -> [NearbySpot] {
        [
            NearbySpot(slug: "la-gaviota", name: "La Gaviota Taquería", kind: .venue, neighborhood: "Little Havana",
                       distanceMeters: 240, liveDisplays: 2, featured: "3D special", latitude: 25.7655, longitude: -80.2190),
            NearbySpot(slug: "back-room", name: "Back Room Bar", kind: .venue, neighborhood: "Little Havana",
                       distanceMeters: 520, liveDisplays: 1, featured: nil, latitude: 25.7672, longitude: -80.2215),
            NearbySpot(slug: "mural-row", name: "Mural Row Gallery", kind: .artist, neighborhood: "Little Havana",
                       distanceMeters: 760, liveDisplays: 3, featured: nil, latitude: 25.7640, longitude: -80.2235),
        ]
    }

    func artist(slug: String) async throws -> PublicArtist {
        PublicArtist(slug: slug, name: "Ana Ruiz", bio: "Florals on the walls of places she eats.",
                     neighborhood: "Little Havana", pieces: [
                        PublicArtistPiece(displayId: "demo-art", title: "Night Bloom", description: "Only after dark.",
                                          mediaUrl: Self.displays[1].mediaUrl, venueName: "Casa Marisol",
                                          venueSlug: "casa-marisol", neighborhood: "Little Havana"),
                        PublicArtistPiece(displayId: "demo-art-2", title: "Agua Viva", description: "A tide pool on the window.",
                                          mediaUrl: nil, venueName: "Back Room Bar",
                                          venueSlug: "back-room", neighborhood: "Little Havana"),
                     ])
    }
}
#endif
