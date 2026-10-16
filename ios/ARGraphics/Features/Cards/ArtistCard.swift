import MapKit
import SwiftUI

/// Artist card: piece title in serif, the artist, a short bio, more of their work,
/// and other ARGraphics spots within walking distance.
struct ArtistCard: View {
    let model: ExperienceModel
    let artist: PublicArtistCredit
    /// False in the collapsed sheet, so the map only loads when the guest opens the card.
    var showsNearby = true

    @State private var showWork = false

    private var display: PublicDisplay { model.display }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Eyebrow(text: "Only at \(model.visit.venue.name)", color: Palette.spotlight, systemImage: "sparkle")
            VStack(alignment: .leading, spacing: 6) {
                Text(display.title)
                    .font(Typography.display(40))
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
                Text("by \(artist.name)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.orchid)
            }
            if let bio = artist.bio, !bio.isEmpty {
                Text(bio)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !display.description.isEmpty, display.description != artist.bio {
                Text(display.description)
                    .font(Typography.bodySmall)
                    .foregroundStyle(Palette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if artist.slug != nil {
                CTAButton(title: "See more of their work", kind: .primary) { showWork = true }
            }
            if showsNearby {
                NearbySection(venueSlug: model.visit.venue.slug)
            }
        }
        .sheet(isPresented: $showWork) {
            if let slug = artist.slug {
                ArtistWorkScreen(slug: slug, fallbackName: artist.name) { showWork = false }
                    .presentationBackground(Palette.midnight)
            }
        }
    }
}

// MARK: - Nearby

@Observable
@MainActor
final class NearbyModel {
    enum State: Equatable {
        case loading
        case loaded([NearbySpot])
        case failed
    }

    private(set) var state: State = .loading

    func load(api: VisitorAPI?, slug: String) async {
        guard let api else { state = .failed; return }
        state = .loading
        do {
            state = .loaded(try await api.nearby(slug: slug))
        } catch {
            state = .failed
        }
    }
}

struct NearbySection: View {
    let venueSlug: String

    @Environment(AppEnvironment.self) private var environment
    @State private var model = NearbyModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Find other ARGraphics spots nearby")
                .font(Typography.h6)
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            switch model.state {
            case .loading:
                RoundedRectangle(cornerRadius: 16)
                    .fill(Palette.indigo)
                    .frame(height: 170)
                    .overlay(ProgressView().tint(Palette.orchid))
            case .failed:
                NoticeBox(systemImage: "map", text: "Nearby spots didn't load. Check your connection.")
            case .loaded(let spots) where spots.isEmpty:
                NoticeBox(systemImage: "map", text: "No other ARGraphics spots within walking distance yet.")
            case .loaded(let spots):
                NearbyMapTile(spots: spots)
                VStack(spacing: 0) {
                    ForEach(spots.prefix(5)) { spot in
                        NearbyRow(spot: spot)
                        if spot.id != spots.prefix(5).last?.id { Divider().overlay(Palette.line) }
                    }
                }
            }
        }
        .task { await model.load(api: environment.api, slug: venueSlug) }
    }
}

/// Small map of walkable venues. Featured spots get a Coral pin, the rest Violet.
struct NearbyMapTile: View {
    let spots: [NearbySpot]

    var body: some View {
        Map(initialPosition: .automatic, interactionModes: [.pan, .zoom]) {
            ForEach(spots) { spot in
                Annotation(spot.name, coordinate: CLLocationCoordinate2D(latitude: spot.latitude, longitude: spot.longitude)) {
                    Circle()
                        .fill(spot.featured == nil ? Palette.violet : Palette.coral)
                        .frame(width: 18, height: 18)
                        .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                        .shadow(color: .black.opacity(0.4), radius: 3)
                }
            }
        }
        .mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))
        .frame(height: 170)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.line))
        .accessibilityLabel("Map of \(spots.count) nearby ARGraphics spots")
    }
}

struct NearbyRow: View {
    let spot: NearbySpot

    var body: some View {
        Button(action: directions) {
            HStack(spacing: 12) {
                Circle()
                    .fill(spot.featured == nil ? Palette.violet : Palette.coral)
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(spot.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(spot.featured ?? "\(spot.liveDisplays) live · \(spot.neighborhood)")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                }
                Spacer()
                Text(Countdown.walk(meters: spot.distanceMeters))
                    .font(Typography.caption)
                    .foregroundStyle(Palette.orchid)
                Image(systemName: "figure.walk")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textMuted)
            }
            .frame(minHeight: Spacing.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityHint("Opens walking directions in Maps")
    }

    private func directions() {
        let coordinate = CLLocationCoordinate2D(latitude: spot.latitude, longitude: spot.longitude)
        let item: MKMapItem
        if #available(iOS 26, *) {
            item = MKMapItem(location: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude), address: nil)
        } else {
            item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        }
        item.name = spot.name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking])
    }
}

// MARK: - Artist work

@Observable
@MainActor
final class ArtistModel {
    enum State: Equatable {
        case loading
        case loaded(PublicArtist)
        case failed(String)
    }

    private(set) var state: State = .loading

    func load(api: VisitorAPI?, slug: String) async {
        guard let api else { state = .failed(APIError.notConfigured.localizedDescription); return }
        state = .loading
        do {
            state = .loaded(try await api.artist(slug: slug))
        } catch APIError.notFound {
            state = .failed("This artist's page isn't up yet.")
        } catch {
            state = .failed((error as? LocalizedError)?.errorDescription ?? APIError.offline.localizedDescription)
        }
    }
}

/// "See more of their work": every live piece and where to see it.
struct ArtistWorkScreen: View {
    let slug: String
    let fallbackName: String
    let onClose: () -> Void

    @Environment(AppEnvironment.self) private var environment
    @State private var model = ArtistModel()

    var body: some View {
        ZStack(alignment: .topTrailing) {
            BokehBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    switch model.state {
                    case .loading:
                        header(name: fallbackName, neighborhood: nil, bio: nil)
                        ProgressView().tint(Palette.orchid).frame(maxWidth: .infinity).padding(.top, Spacing.xl)
                    case .failed(let message):
                        header(name: fallbackName, neighborhood: nil, bio: nil)
                        ErrorStateView(message: message) { Task { await model.load(api: environment.api, slug: slug) } }
                    case .loaded(let artist):
                        header(name: artist.name, neighborhood: artist.neighborhood, bio: artist.bio)
                        if artist.pieces.isEmpty {
                            NoticeBox(systemImage: "paintpalette", text: "No pieces are up right now. Check back soon.")
                        } else {
                            Text("Where to see their work")
                                .font(Typography.h6)
                                .foregroundStyle(.white)
                            ForEach(artist.pieces) { piece in ArtistPieceRow(piece: piece) }
                        }
                    }
                }
                .padding(.horizontal, Spacing.m)
                .padding(.top, Spacing.xxl)
                .padding(.bottom, Spacing.xl)
            }
            SheetCloseButton(action: onClose).padding(Spacing.s)
        }
        .task { await model.load(api: environment.api, slug: slug) }
    }

    private func header(name: String, neighborhood: String?, bio: String?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            BrandMark(trailing: neighborhood)
            Text(name)
                .font(Typography.display(40))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            if let bio, !bio.isEmpty {
                Text(bio).font(Typography.body).foregroundStyle(Palette.textMuted)
            }
        }
    }
}

/// Artist piece card (spotlight variant): artwork, title in serif, and where it lives.
struct ArtistPieceRow: View {
    let piece: PublicArtistPiece

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(url: piece.mediaURL, placeholderSymbol: "paintpalette")
                .frame(height: 180)
                .frame(maxWidth: .infinity)
                .clipped()
            VStack(alignment: .leading, spacing: 6) {
                Text(piece.title)
                    .font(Typography.display(24))
                    .foregroundStyle(.white)
                if !piece.description.isEmpty {
                    Text(piece.description)
                        .font(Typography.bodySmall)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(3)
                }
                Label("\(piece.venueName) · \(piece.neighborhood)", systemImage: "mappin.and.ellipse")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Palette.spotlight)
            }
            .padding(Spacing.m)
        }
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.line))
        .accessibilityElement(children: .combine)
    }
}
