import SwiftUI

/// A code that shows several things: the whole menu stands round the printed code in AR.
/// Tap a miniature to bring it up to real size; "See more" opens the full experience with
/// the card, claims and sharing.
struct MenuExperienceScreen: View {
    let visit: Visit
    let onOpen: (PublicDisplay) -> Void
    let onShowList: () -> Void

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: MenuExperienceModel
    @State private var shareMoment: ShareMoment?
    @State private var capturing = false
    @State private var torchOn = false
    @State private var bottomInset: CGFloat = 0

    init(visit: Visit, onOpen: @escaping (PublicDisplay) -> Void, onShowList: @escaping () -> Void) {
        self.visit = visit
        self.onOpen = onOpen
        self.onShowList = onShowList
        _model = State(initialValue: MenuExperienceModel(visit: visit))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ARMenuView(model: model).ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.55), .clear, .clear], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            if model.phase == .finding {
                ScanReticle(tight: true).frame(width: 200, height: 200).allowsHitTesting(false)
            }
            overlay
        }
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { bottomInset = $0 }
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.prepare(assets: environment.assets, images: environment.images) }
        .sheet(item: $shareMoment) { moment in
            ShareMomentSheet(moment: moment, venueName: visit.venue.name, canRecordClip: false,
                             onRecordClip: {}, onClose: { shareMoment = nil })
                .presentationDetents([.large])
                .presentationBackground(Palette.midnight)
        }
        .animation(Motion.sheet(reduceMotion: reduceMotion), value: model.selectedId)
        .animation(.easeInOut(duration: 0.2), value: model.phase)
    }

    private var overlay: some View {
        VStack(spacing: Spacing.m) {
            topBar
            header
            Spacer()
            status
            HStack {
                Spacer()
                if case .placed = model.phase { shutter }
            }
            .padding(.horizontal, Spacing.m)
            bottom
        }
        .ignoresSafeArea(.container, edges: .bottom)
    }

    private var topBar: some View {
        HStack {
            CircleIconButton(systemImage: "xmark", label: "Back to the scanner") { dismiss() }
            Spacer()
            BrandMark(trailing: visit.spot?.label ?? visit.venue.name).lineLimit(1)
            Spacer()
            if Torch.isAvailable {
                CircleIconButton(systemImage: torchOn ? "flashlight.on.fill" : "flashlight.off.fill",
                                 label: torchOn ? "Turn the light off" : "Turn the light on") { torchOn = Torch.set(!torchOn) }
            }
            CircleIconButton(systemImage: "list.bullet", label: "See the menu as a list", action: onShowList)
        }
        .padding(.horizontal, Spacing.m)
        .onDisappear { if torchOn { torchOn = Torch.set(false) } }
    }

    /// Venue name until the menu lands; then the chosen item's price chip.
    @ViewBuilder private var header: some View {
        if let selected = model.selected {
            PriceChip(name: selected.display.title, price: selected.display.price).transition(.opacity)
        } else if case .placed = model.phase {
            Text("\(model.items.count) on the menu")
                .font(Typography.bodySmall)
                .foregroundStyle(Palette.textMuted)
                .transition(.opacity)
        } else {
            VStack(spacing: 6) {
                Text(visit.venue.name)
                    .font(Typography.h1)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
                if let spot = visit.spot {
                    Text(spot.label).font(Typography.bodySmall).foregroundStyle(Palette.textMuted)
                }
            }
            .padding(.horizontal, Spacing.m)
            .transition(.opacity)
        }
    }

    @ViewBuilder private var status: some View {
        switch model.phase {
        case .failed(let message):
            VStack(spacing: Spacing.s) {
                StatusPill(text: message, systemImage: "exclamationmark.triangle")
                Button("See it as a list", action: onShowList)
                    .font(Typography.button)
                    .frame(minHeight: Spacing.touch)
            }
            .padding(.horizontal, Spacing.m)
        case .finding:
            StatusPill(text: model.readyCount == 0 ? "Getting the menu ready" : "Keep the code in view", showsSpinner: true)
        case .placed(let onCode):
            if model.selected != nil {
                StatusPill(text: "Tap the table to put it back", systemImage: "hand.tap").transition(.opacity)
            } else if model.readyCount < model.items.count {
                StatusPill(text: "\(model.readyCount) of \(model.items.count) ready", showsSpinner: true)
            } else {
                StatusPill(text: onCode ? "On your code. Tap one to bring it up close" : "Tap one to bring it up close · point at the code to pin the menu to it",
                           systemImage: onCode ? "qrcode" : "hand.tap")
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Spacing.m)
                    .transition(.opacity)
            }
        }
    }

    private var shutter: some View {
        Button { Task { await sharePhoto() } } label: {
            Circle()
                .fill(.white)
                .frame(width: 58, height: 58)
                .overlay(Circle().strokeBorder(Color.black.opacity(0.15), lineWidth: 2).padding(4))
                .frame(width: 68, height: 68)
                .overlay(Circle().strokeBorder(.white.opacity(0.6), lineWidth: 2))
        }
        .buttonStyle(PressScaleStyle())
        .disabled(capturing)
        .accessibilityLabel("Take a photo to share")
    }

    /// The chosen item's card; otherwise a hint about anything that didn't fit on the arc.
    @ViewBuilder private var bottom: some View {
        if let selected = model.selected {
            SheetCard(onClose: { model.select(nil) }, closeLabel: "Put it back", bottomInset: bottomInset) {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    Text(selected.display.typeLabel.uppercased())
                        .font(Typography.eyebrow).tracking(1)
                        .foregroundStyle(Palette.tangerine)
                    Text(selected.display.title)
                        .font(Typography.h5)
                        .foregroundStyle(.white)
                    if let line = subtitle(for: selected.display) {
                        Text(line).font(Typography.bodySmall).foregroundStyle(Palette.textMuted).lineLimit(3)
                    }
                    CTAButton(title: cta(for: selected.display), systemImage: "arrow.up.right", kind: .primary) {
                        onOpen(selected.display)
                    }
                }
                .padding(.trailing, Spacing.xl)
            }
            .transition(Motion.sheetTransition(reduceMotion: reduceMotion))
        } else if model.overflowCount > 0, case .placed = model.phase {
            Button(action: onShowList) {
                Text("\(model.overflowCount) more as a list")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(height: Spacing.touch)
                    .padding(.horizontal, Spacing.m)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            .buttonStyle(PressScaleStyle())
            .padding(.bottom, Spacing.s + bottomInset)
        } else {
            Color.clear.frame(height: Spacing.s + bottomInset)
        }
    }

    private func subtitle(for display: PublicDisplay) -> String? {
        if let offer = display.offer { return offer.title }
        if let ingredients = display.ingredients, !ingredients.isEmpty { return ingredients }
        if let artist = display.artist { return "by \(artist.name)" }
        return display.description.isEmpty ? nil : display.description
    }

    private func cta(for display: PublicDisplay) -> String {
        switch display.type {
        case .promoOffer: return "See the offer"
        case .artPiece: return "About the piece"
        default: return "See more"
        }
    }

    private func sharePhoto() async {
        capturing = true
        defer { capturing = false }
        guard let image = await model.snapshot() else { return }
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        shareMoment = .photo(Watermark.apply(to: image, venue: visit.venue.name))
    }
}
