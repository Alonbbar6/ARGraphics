import SwiftUI

/// What's live at a venue, for codes that don't point at one display (and venue links).
struct VenueScreen: View {
    let visit: Visit
    let onSelect: (PublicDisplay) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BokehBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    header
                    if visit.displays.isEmpty {
                        NoticeBox(systemImage: "moon.stars",
                                  text: "Nothing's live here right now. Ask your server what's on tonight.")
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(visit.displays) { display in
                                Button { onSelect(display) } label: { DisplayRow(display: display) }
                                    .buttonStyle(PressScaleStyle())
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.m)
                .padding(.bottom, Spacing.xl)
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                CircleIconButton(systemImage: "xmark", label: "Back to the scanner") { dismiss() }
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            BrandMark(trailing: visit.spot?.label ?? visit.venue.neighborhood)
            Text(visit.venue.name)
                .font(Typography.display(44))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.6)
                .accessibilityAddTraits(.isHeader)
            Text(visit.displays.isEmpty ? visit.venue.bio : "Here tonight. Tap one to see it right where you are.")
                .font(Typography.body)
                .foregroundStyle(Palette.textMuted)
        }
        .padding(.top, Spacing.s)
    }
}

struct DisplayRow: View {
    let display: PublicDisplay

    var body: some View {
        HStack(spacing: 14) {
            RemoteImage(url: display.thumbnailURL ?? display.mediaURL, placeholderSymbol: symbol)
                .frame(width: 76, height: 76)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(display.typeLabel.uppercased())
                        .font(Typography.eyebrow).tracking(1)
                        .foregroundStyle(display.type == .artPiece ? Palette.spotlight : Palette.tangerine)
                    if display.modelURL != nil {
                        Text("3D")
                            .font(.system(size: 10, weight: .heavy))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Palette.violet, in: Capsule())
                    }
                }
                Text(display.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                if let subtitle {
                    Text(subtitle)
                        .font(Typography.bodySmall)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            Spacer(minLength: 0)
            if let price = display.price {
                Text(price)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.tangerine)
            }
        }
        .padding(12)
        .frame(minHeight: Spacing.touch)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Palette.line))
        .contentShape(RoundedRectangle(cornerRadius: 22))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens it in your space")
    }

    private var subtitle: String? {
        if let offer = display.offer { return offer.title }
        if let artist = display.artist { return "by \(artist.name)" }
        return display.description.isEmpty ? nil : display.description
    }

    private var symbol: String {
        switch display.type {
        case .menuItem: return "fork.knife"
        case .artPiece: return "paintpalette"
        case .eventTeaser: return "calendar"
        case .promoOffer: return "tag"
        case .unknown: return "sparkles"
        }
    }
}
