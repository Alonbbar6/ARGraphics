import Foundation

// Mirrors the `ios`-tagged schemas in lib/api-spec/openapi.yaml.
// Unknown response fields are ignored and unknown enum values decode to `.unknown`,
// so the server can add things without breaking installed apps.

// MARK: - Enums

/// String enums that tolerate values added to the contract later.
protocol OpenEnum: RawRepresentable, Codable, Hashable, Sendable where RawValue == String {
    static var unknownCase: Self { get }
}

extension OpenEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownCase
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum DisplayType: String, OpenEnum {
    case menuItem = "menu_item"
    case promoOffer = "promo_offer"
    case artPiece = "art_piece"
    case eventTeaser = "event_teaser"
    case unknown

    static var unknownCase: DisplayType { .unknown }
}

enum Placement: String, OpenEnum {
    case table, wall, window, poster
    case unknown

    static var unknownCase: Placement { .unknown }

    /// Walls, windows and posters are vertical surfaces; everything else sits on a table.
    var isVertical: Bool { self == .wall || self == .window || self == .poster }

    var hint: String {
        switch self {
        case .table, .unknown: return "Point at the table"
        case .wall: return "Point at the wall"
        case .window: return "Point at the window"
        case .poster: return "Point at the poster"
        }
    }
}

enum PartnerKind: String, OpenEnum {
    case venue, artist
    case unknown

    static var unknownCase: PartnerKind { .unknown }
}

// MARK: - Scan & venue

struct ScanInput: Codable, Equatable {
    let code: String
    let visitorId: String
}

struct PublicVenueSummary: Codable, Hashable {
    let slug: String
    let name: String
    let kind: PartnerKind
    let neighborhood: String
    let bio: String
}

struct PublicOffer: Codable, Hashable {
    let title: String
    let details: String
    let endsAt: Date?
}

struct PublicArtistCredit: Codable, Hashable {
    let name: String
    let slug: String?
    let bio: String?
}

struct PublicDisplay: Codable, Hashable, Identifiable {
    let id: String
    let type: DisplayType
    let placement: Placement
    let title: String
    let description: String
    let mediaUrl: String?
    let thumbnailUrl: String?
    let modelUsdzUrl: String?
    let modelGlbUrl: String?
    let price: String?
    let offer: PublicOffer?
    let eventStartsAt: Date?
    let artist: PublicArtistCredit?

    var mediaURL: URL? { MediaURL.parse(mediaUrl) }
    var thumbnailURL: URL? { MediaURL.parse(thumbnailUrl) }
    /// ARKit and RealityKit load USDZ natively; GLB is for the web viewer only.
    var modelURL: URL? { MediaURL.parse(modelUsdzUrl) }

    var typeLabel: String {
        switch type {
        case .menuItem: return "On the menu"
        case .promoOffer: return "Offer"
        case .artPiece: return "Art"
        case .eventTeaser: return "Coming up"
        case .unknown: return "Tonight"
        }
    }
}

struct PublicSpot: Codable, Hashable {
    let label: String
    let placement: Placement
}

struct PublicTableCard: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let referenceImageUrl: String
    let physicalWidthCm: Double
}

struct ScanResult: Codable, Hashable {
    let venue: PublicVenueSummary
    let spot: PublicSpot
    let display: PublicDisplay?
    let displays: [PublicDisplay]
    let tableCards: [PublicTableCard]
}

struct PublicVenue: Codable, Hashable {
    let venue: PublicVenueSummary
    let displays: [PublicDisplay]
    let tableCards: [PublicTableCard]
}

// MARK: - Claims

struct ClaimInput: Codable, Equatable {
    let visitorId: String
    let code: String?
}

struct Claim: Codable, Hashable {
    let confirmationCode: String
    let offerTitle: String
    let venueName: String
    let spotLabel: String?
    let claimedAt: Date
    let expiresAt: Date
}

// MARK: - Discovery

struct NearbySpot: Codable, Hashable, Identifiable {
    let slug: String
    let name: String
    let kind: PartnerKind
    let neighborhood: String
    let distanceMeters: Int
    let liveDisplays: Int
    let featured: String?
    let latitude: Double
    let longitude: Double

    var id: String { slug }
}

struct PublicArtistPiece: Codable, Hashable, Identifiable {
    let displayId: String
    let title: String
    let description: String
    let mediaUrl: String?
    let venueName: String
    let venueSlug: String
    let neighborhood: String

    var id: String { displayId }
    var mediaURL: URL? { MediaURL.parse(mediaUrl) }
}

struct PublicArtist: Codable, Hashable {
    let slug: String
    let name: String
    let bio: String
    let neighborhood: String
    let pieces: [PublicArtistPiece]
}

struct APIErrorBody: Decodable {
    let error: String
}

// MARK: - Helpers

enum MediaURL {
    /// Only web URLs from the API are loaded. Debug builds also allow local files for the demo data.
    static func parse(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw), let scheme = url.scheme?.lowercased() else { return nil }
        if scheme == "https" || scheme == "http" { return url.host == nil ? nil : url }
        #if DEBUG
        if scheme == "file" { return url }
        #endif
        return nil
    }
}

enum APIDate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parse(_ value: String) -> Date? {
        fractional.date(from: value) ?? plain.date(from: value)
    }

    static func string(_ date: Date) -> String {
        fractional.string(from: date)
    }
}

extension JSONDecoder {
    /// Decoder for every API response: ISO 8601 dates with or without fractional seconds.
    static var api: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = APIDate.parse(raw) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date: \(raw)")
            }
            return date
        }
        return decoder
    }
}

extension JSONEncoder {
    static var api: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(APIDate.string(date))
        }
        return encoder
    }
}
