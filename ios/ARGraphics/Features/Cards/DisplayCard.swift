import SwiftUI

/// The card for a display, shared by the AR bottom sheet and the camera-off page.
struct DisplayCard: View {
    let model: ExperienceModel
    var showsNearby = true
    let onClaim: () -> Void
    let onShowClaim: () -> Void

    var body: some View {
        switch model.card {
        case .offer(let offer):
            OfferCard(model: model, offer: offer, onClaim: onClaim, onShowClaim: onShowClaim)
        case .artist(let artist):
            ArtistCard(model: model, artist: artist, showsNearby: showsNearby)
        case .info:
            InfoCard(display: model.display)
        }
    }

    /// One line for the collapsed sheet, like "Tonight: free agua fresca".
    static func peekTitle(for model: ExperienceModel) -> String {
        switch model.card {
        case .offer(let offer): return offer.title
        case .artist: return model.display.title
        case .info: return model.display.title
        }
    }

    static func peekSubtitle(for model: ExperienceModel) -> String {
        switch model.card {
        case .offer: return "Tap to claim"
        case .artist(let artist): return "by \(artist.name)"
        case .info:
            if let price = model.display.price { return price }
            return model.display.typeLabel
        }
    }

    static func peekSymbol(for model: ExperienceModel) -> String {
        switch model.card {
        case .offer: return "tag.fill"
        case .artist: return "paintpalette.fill"
        case .info: return model.display.type == .eventTeaser ? "calendar" : "fork.knife"
        }
    }
}

/// Menu items, event teasers and anything without an offer or artist.
struct InfoCard: View {
    let display: PublicDisplay

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Eyebrow(text: display.typeLabel, color: Palette.tangerine)
            HStack(alignment: .firstTextBaseline) {
                Text(display.title)
                    .font(Typography.display(32))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let price = display.price {
                    Text(price)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Palette.tangerine)
                }
            }
            if let starts = display.eventStartsAt {
                Label(starts.formatted(.dateTime.weekday(.wide).month().day().hour().minute()), systemImage: "calendar")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.tangerine)
            }
            if !display.description.isEmpty {
                Text(display.description)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if display.type == .menuItem {
                Text("Order it from your server.")
                    .font(Typography.bodySmall)
                    .foregroundStyle(Palette.textMuted)
            }
        }
    }
}
