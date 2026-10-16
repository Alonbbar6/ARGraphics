import SwiftUI
import UIKit

/// One display, in the guest's space. AR when the camera is on, otherwise a normal page
/// with the card (and a 3D turntable for menu items).
struct ExperienceScreen: View {
    let visit: Visit
    let display: PublicDisplay
    let onShowVenue: () -> Void

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: ExperienceModel
    @State private var sheet: SheetState = .peek
    @State private var showConfirmation = false
    @State private var shareMoment: ShareMoment?
    @State private var capturing = false
    @State private var torchOn = false
    @State private var recordingStartedAt: Date?
    @State private var notice: String?
    @State private var screenHeight: CGFloat = 800
    @State private var bottomInset: CGFloat = 0

    enum SheetState { case hidden, peek, expanded }

    init(visit: Visit, display: PublicDisplay, onShowVenue: @escaping () -> Void) {
        self.visit = visit
        self.display = display
        self.onShowVenue = onShowVenue
        _model = State(initialValue: ExperienceModel(visit: visit, display: display))
    }

    private var isRecording: Bool { recordingStartedAt != nil }

    var body: some View {
        Group {
            switch model.mode {
            case .ar: arLayout
            case .flat(let reason): FlatExperiencePage(model: model, reason: reason, chrome: AnyView(topBar),
                                                       showConfirmation: $showConfirmation, onClaim: claim)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { screenHeight = $0 }
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { bottomInset = $0 }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            #if DEBUG
            // Screenshot hook for the staff-facing confirmation: `-ARGraphicsDemoAutoClaim YES`.
            if UserDefaults.standard.bool(forKey: "ARGraphicsDemoAutoClaim"), case .offer = model.card { claim() }
            #endif
            await model.prepare(assets: environment.assets, images: environment.images)
        }
        .sheet(item: $shareMoment) { moment in
            ShareMomentSheet(
                moment: moment,
                venueName: visit.venue.name,
                canRecordClip: model.mode == .ar && ClipRecorder.isAvailable,
                onRecordClip: { shareMoment = nil; Task { await recordClip() } },
                onClose: { shareMoment = nil }
            )
            .presentationDetents([.large])
            .presentationBackground(Palette.midnight)
        }
        .onDisappear { if isRecording { ClipRecorder.cancel() } }
    }

    // MARK: AR

    private var arLayout: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ARExperienceView(model: model).ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.55), .clear, .clear], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            if model.phase == .finding && !isRecording {
                ScanReticle().frame(width: 200, height: 200).allowsHitTesting(false)
            }

            if isRecording {
                recordingOverlay
            } else {
                arOverlay
            }
        }
    }

    private var arOverlay: some View {
        VStack(spacing: Spacing.m) {
            topBar
            arHeader
            Spacer()
            phaseIndicator
            HStack {
                Spacer()
                if case .placed = model.phase { shutter }
            }
            .padding(.horizontal, Spacing.m)
            sheetView
        }
        .ignoresSafeArea(.container, edges: .bottom)
    }

    /// Venue name in serif until the content lands; then just the price chip for menu items.
    @ViewBuilder private var arHeader: some View {
        if case .placed = model.phase {
            if display.type == .menuItem {
                PriceChip(name: display.title, price: display.price)
                    .transition(.opacity)
            }
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

    private var topBar: some View {
        HStack {
            CircleIconButton(systemImage: "xmark", label: "Back") { dismiss() }
            Spacer()
            BrandMark(trailing: visit.venue.name).lineLimit(1)
            Spacer()
            if model.mode == .ar, Torch.isAvailable {
                CircleIconButton(systemImage: torchOn ? "flashlight.on.fill" : "flashlight.off.fill",
                                 label: torchOn ? "Turn the light off" : "Turn the light on") {
                    torchOn = Torch.set(!torchOn)
                }
            }
            CircleIconButton(systemImage: "square.and.arrow.up", label: "Share a photo") { Task { await sharePhoto() } }
                .disabled(capturing || !canShare)
                .opacity(canShare ? 1 : 0)
                .accessibilityHidden(!canShare)
        }
        .padding(.horizontal, Spacing.m)
        .onDisappear { if torchOn { torchOn = Torch.set(false) } }
    }

    private var canShare: Bool {
        switch model.mode {
        case .ar: if case .placed = model.phase { return true } else { return false }
        case .flat: return model.modelFile != nil || model.panelImage != nil
        }
    }

    @ViewBuilder private var phaseIndicator: some View {
        if let notice {
            StatusPill(text: notice, systemImage: "info.circle").padding(.horizontal, Spacing.m)
        } else {
            switch model.phase {
            case .failed(let message):
                VStack(spacing: Spacing.s) {
                    StatusPill(text: message, systemImage: "exclamationmark.triangle")
                    Button("Try again") { Task { await model.retry(assets: environment.assets, images: environment.images) } }
                        .font(Typography.button)
                        .frame(minHeight: Spacing.touch)
                }
                .padding(.horizontal, Spacing.m)
            case .loading:
                StatusPill(text: display.placement.hint, showsSpinner: true)
            case .finding:
                StatusPill(text: model.tableCards.isEmpty ? display.placement.hint : "Point at the table card",
                           showsSpinner: true)
            case .placed:
                StatusPill(text: display.placement.isVertical ? "Tap the wall to move it" : "Tap the table to move it",
                           systemImage: "hand.tap")
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

    // MARK: Bottom sheet

    @ViewBuilder private var sheetView: some View {
        Group {
            switch sheet {
            case .hidden:
                Button { setSheet(.peek) } label: {
                    VStack(spacing: 6) {
                        Capsule().fill(Color.white.opacity(0.5)).frame(width: 40, height: 5)
                        Text("Details").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    }
                    .frame(width: 120, height: Spacing.touch)
                    .background(.ultraThinMaterial, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(PressScaleStyle())
                .padding(.bottom, Spacing.s + bottomInset)
                .accessibilityLabel("Show details")
            case .peek:
                SheetCard(onClose: { setSheet(.hidden) }, closeLabel: "Hide details", bottomInset: bottomInset) { peekRow }
            case .expanded:
                SheetCard(onClose: { closeExpanded() }, bottomInset: bottomInset) {
                    ScrollView {
                        expandedContent.padding(.top, Spacing.s)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    .frame(maxHeight: screenHeight * 0.66)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .transition(Motion.sheetTransition(reduceMotion: reduceMotion))
        .gesture(DragGesture(minimumDistance: 20).onEnded { value in
            if value.translation.height < -30 { setSheet(.expanded) }
            if value.translation.height > 30 { sheet == .expanded ? closeExpanded() : setSheet(.hidden) }
        })
    }

    private var peekRow: some View {
        Button { setSheet(.expanded) } label: {
            HStack(spacing: 12) {
                Image(systemName: DisplayCard.peekSymbol(for: model))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.tangerine)
                    .frame(width: 40, height: 40)
                    .background(Palette.tangerine.opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(DisplayCard.peekTitle(for: model))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("\(DisplayCard.peekSubtitle(for: model)) · swipe up")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: 40)
            }
            .frame(minHeight: Spacing.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the card")
    }

    @ViewBuilder private var expandedContent: some View {
        if showConfirmation, case .claimed(let claim) = model.claimState {
            ClaimConfirmedView(claim: claim, backTitle: "Back to the 3D view") { closeExpanded() }
        } else {
            VStack(alignment: .leading, spacing: Spacing.l) {
                DisplayCard(model: model, onClaim: claim, onShowClaim: { showConfirmation = true })
                if visit.displays.count > 1 {
                    Button(action: onShowVenue) {
                        Label("More at \(visit.venue.name) tonight", systemImage: "square.grid.2x2")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Palette.orchid)
                            .frame(minHeight: Spacing.touch)
                    }
                }
            }
        }
    }

    private func setSheet(_ state: SheetState) {
        withAnimation(Motion.sheet(reduceMotion: reduceMotion)) { sheet = state }
    }

    private func closeExpanded() {
        withAnimation(Motion.sheet(reduceMotion: reduceMotion)) {
            showConfirmation = false
            sheet = .peek
        }
    }

    // MARK: Actions

    private func claim() {
        Task {
            await model.claim(api: environment.api, visitorId: environment.identity.id)
            if case .claimed = model.claimState {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                withAnimation(Motion.sheet(reduceMotion: reduceMotion)) {
                    showConfirmation = true
                    sheet = .expanded
                }
            } else {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            }
        }
    }

    private func sharePhoto() async {
        capturing = true
        defer { capturing = false }
        guard let image = await model.snapshot() else { return }
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        shareMoment = .photo(Watermark.apply(to: image, venue: visit.venue.name))
    }

    /// Hides every control, records a short clip with only the watermark on screen,
    /// then opens the share sheet with it.
    private func recordClip() async {
        try? await Task.sleep(for: .milliseconds(450)) // let the share sheet finish closing
        do {
            try await ClipRecorder.start()
        } catch {
            show(notice: "Clips need screen recording. You can still share a photo.")
            return
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        recordingStartedAt = .now
        try? await Task.sleep(for: ClipRecorder.duration)
        recordingStartedAt = nil
        do {
            let url = try await ClipRecorder.stop()
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
            shareMoment = .clip(url)
        } catch {
            show(notice: "That clip didn't save. Try a photo instead.")
        }
    }

    private func show(notice text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
    }

    /// The only thing on screen while a clip records: the watermark, with a thin progress ring.
    private var recordingOverlay: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                TimelineView(.animation) { context in
                    let elapsed = recordingStartedAt.map { context.date.timeIntervalSince($0) } ?? 0
                    let total = Double(ClipRecorder.duration.components.seconds)
                    HStack(spacing: 6) {
                        ZStack {
                            Circle().stroke(.white.opacity(0.25), lineWidth: 2)
                            Circle().trim(from: 0, to: min(1, elapsed / total))
                                .stroke(Palette.coral, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                        }
                        .frame(width: 14, height: 14)
                        Text(Watermark.text(venue: visit.venue.name))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.82))
                            .shadow(color: .black.opacity(0.55), radius: 6)
                    }
                }
                .padding(Spacing.m)
            }
        }
        .allowsHitTesting(false)
        .accessibilityLabel("Recording a clip")
    }
}

/// Camera off, no AR, or nothing to place: a normal page with the media and the card.
struct FlatExperiencePage: View {
    let model: ExperienceModel
    let reason: ExperienceModel.FlatReason
    let chrome: AnyView
    @Binding var showConfirmation: Bool
    let onClaim: () -> Void

    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ZStack {
            BokehBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    chrome.padding(.horizontal, -Spacing.m)
                    media
                    notice
                    VStack(alignment: .leading, spacing: Spacing.m) {
                        if showConfirmation, case .claimed(let claim) = model.claimState {
                            ClaimConfirmedView(claim: claim, backTitle: "Done") { showConfirmation = false }
                        } else {
                            DisplayCard(model: model, onClaim: onClaim, onShowClaim: { showConfirmation = true })
                        }
                    }
                    .padding(Spacing.l)
                    .background(
                        LinearGradient(colors: [Palette.sheet, Palette.indigo], startPoint: .top, endPoint: .bottom),
                        in: RoundedRectangle(cornerRadius: 24)
                    )
                }
                .padding(.horizontal, Spacing.m)
                .padding(.bottom, Spacing.xl)
            }
        }
        .onChange(of: model.claimState) { _, state in
            if case .claimed = state { showConfirmation = true }
        }
    }

    @ViewBuilder private var media: some View {
        switch model.content {
        case .model:
            ZStack {
                if case .failed(let message) = model.phase {
                    ErrorStateView(message: message) {
                        Task { await model.retry(assets: environment.assets, images: environment.images) }
                    }
                } else {
                    ModelViewer(model: model, centered: true)
                        .accessibilityLabel("3D model of \(model.display.title). Drag to turn it.")
                    if model.modelFile == nil { ProgressView().tint(Palette.orchid) }
                }
            }
            .frame(height: 320)
        case .panel(_, let framed):
            FramedArtwork(image: model.panelImage, framed: framed, failed: model.phase.isFailed)
                .frame(maxWidth: .infinity)
        case .none:
            if let thumbnail = model.display.thumbnailURL {
                RemoteImage(url: thumbnail)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
            }
        }
    }

    @ViewBuilder private var notice: some View {
        switch reason {
        case .cameraOff:
            VStack(spacing: Spacing.m) {
                NoticeBox(systemImage: "camera",
                          text: "Camera is off, so you're seeing the flat version. The one in your space is better.")
                CTAButton(title: "Turn on camera", systemImage: "camera", kind: .outline) { openAppSettings() }
            }
        case .arUnsupported:
            if model.content != .none {
                NoticeBox(systemImage: "cube.transparent",
                          text: "This phone can't place things in the room, so here's the flat version.")
            }
        case .noMedia:
            EmptyView()
        }
    }
}

/// Artwork as a framed piece (art) or a rounded card (posters, offers), with a soft Orchid glow.
struct FramedArtwork: View {
    let image: UIImage?
    let framed: Bool
    let failed: Bool

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding(framed ? 10 : 0)
                    .background(framed ? Color(hex: 0x14102A) : .clear)
                    .overlay {
                        if framed {
                            Rectangle().strokeBorder(Palette.spotlight.opacity(0.6), lineWidth: 1).padding(6)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: framed ? 2 : 18))
                    .shadow(color: Palette.orchid.opacity(0.55), radius: 36)
                    .shadow(color: Palette.violet.opacity(0.35), radius: 70)
                    .frame(maxHeight: 420)
                    .accessibilityHidden(true)
            } else if failed {
                NoticeBox(systemImage: "photo", text: "The artwork didn't load. Check your connection.")
            } else {
                RoundedRectangle(cornerRadius: 18).fill(Palette.indigo).frame(height: 300)
                    .overlay(ProgressView().tint(Palette.orchid))
            }
        }
        .padding(.vertical, Spacing.m)
    }
}

extension ExperienceModel.Phase {
    var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
}
