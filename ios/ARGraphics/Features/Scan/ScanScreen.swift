import AVFoundation
import SwiftUI

/// Scan landing: full-screen camera, pulsing violet reticle, one-line hint.
/// As soon as the code resolves, the venue name lands in serif over the camera.
struct ScanScreen: View {
    let resolver: VisitResolver
    /// False while a visit is pushed on top, so the camera stops reporting codes.
    let isActive: Bool
    let onLink: (ScanLink) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var permission = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var cameraUnavailable = AVCaptureDevice.default(for: .video) == nil
    @State private var torchOn = false
    @State private var showManualEntry = false
    @State private var notice: String?
    @State private var noticeTask: Task<Void, Never>?

    private var cameraReady: Bool { permission == .authorized && !cameraUnavailable }

    private var resolvedVenue: Visit? {
        if case .resolved(let visit) = resolver.state { return visit }
        return nil
    }

    var body: some View {
        ZStack {
            if cameraReady {
                QRScannerView(
                    isScanning: isActive && !resolver.isBusy,
                    torchOn: torchOn,
                    onCode: handle(code:),
                    onUnavailable: { cameraUnavailable = true }
                )
                .ignoresSafeArea()
                LinearGradient(colors: [.black.opacity(0.65), .clear, .clear, .black.opacity(0.75)],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            } else {
                BokehBackground()
            }

            VStack(spacing: 0) {
                header
                Spacer()
                if cameraReady {
                    ScanReticle(tight: resolver.isBusy || resolvedVenue != nil)
                        .frame(width: 230, height: 230)
                    Spacer()
                    hint
                } else {
                    cameraOffCard
                    Spacer()
                }
                controls
            }
            .padding(.horizontal, Spacing.m)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await requestCameraIfNeeded() }
        .onChange(of: isActive) { _, active in if !active { torchOn = false } }
        .onChange(of: resolver.state) { _, state in
            switch state {
            case .failed(let message):
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                show(notice: message)
            case .resolved(let visit):
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                UIAccessibility.post(notification: .announcement, argument: visit.venue.name)
            default:
                break
            }
        }
        .sheet(isPresented: $showManualEntry) {
            ManualCodeSheet(onClose: { showManualEntry = false }) { link in
                showManualEntry = false
                onLink(link)
            }
            .presentationDetents([.height(340)])
            .presentationBackground(Palette.sheet)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: Spacing.s) {
            if let visit = resolvedVenue {
                BrandMark(trailing: visit.spot?.label ?? visit.venue.neighborhood)
                Text(visit.venue.name)
                    .font(Typography.h1)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94)))
            } else {
                BrandMark()
                Text("Scan the code")
                    .font(Typography.h1)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text("Tonight's specials, art and offers, right where you're sitting.")
                    .font(Typography.bodySmall)
                    .foregroundStyle(Palette.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.15) : .spring(response: 0.4, dampingFraction: 0.75),
                   value: resolvedVenue?.id)
        .padding(.top, Spacing.xl)
    }

    @ViewBuilder private var hint: some View {
        if let notice {
            StatusPill(text: notice, systemImage: "exclamationmark.circle")
                .multilineTextAlignment(.center)
        } else if resolver.isBusy {
            StatusPill(text: "Opening…", showsSpinner: true)
        } else if let visit = resolvedVenue {
            StatusPill(text: visit.display?.placement.hint ?? "See what's on tonight", showsSpinner: true)
        } else {
            StatusPill(text: "Point at the code on your table", systemImage: "qrcode.viewfinder")
        }
    }

    // MARK: Camera off

    private var cameraOffCard: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            NoticeBox(
                systemImage: "camera",
                text: cameraUnavailable
                    ? "This device has no camera we can use. Type the code printed under the QR instead."
                    : "Camera is off, so we can't read the code at your table."
            )
            if let notice {
                StatusPill(text: notice, systemImage: "exclamationmark.circle")
            } else if resolver.isBusy {
                StatusPill(text: "Opening…", showsSpinner: true)
            }
            if !cameraUnavailable {
                // With no camera, turning it on is the one thing that gets the guest scanning.
                CTAButton(title: permission == .notDetermined ? "Scan a code" : "Turn on camera",
                          systemImage: "qrcode.viewfinder", kind: .hero) {
                    if permission == .notDetermined {
                        Task { await requestCameraIfNeeded() }
                    } else {
                        openAppSettings()
                    }
                }
            }
            CTAButton(title: "Type the code instead", systemImage: "keyboard",
                      kind: cameraUnavailable ? .primary : .outline) { showManualEntry = true }
        }
        .padding(.top, Spacing.xl)
    }

    private var controls: some View {
        HStack {
            if cameraReady {
                CircleIconButton(systemImage: "keyboard", label: "Type the code instead") { showManualEntry = true }
                Spacer()
                CircleIconButton(systemImage: torchOn ? "bolt.fill" : "bolt.slash",
                                 label: torchOn ? "Turn off flashlight" : "Turn on flashlight") { torchOn.toggle() }
            }
        }
        .padding(.vertical, Spacing.l)
    }

    // MARK: Actions

    private func requestCameraIfNeeded() async {
        guard permission == .notDetermined, !cameraUnavailable else { return }
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        permission = granted ? .authorized : .denied
    }

    private func handle(code: String) {
        guard isActive, !resolver.isBusy else { return }
        if let link = ScanLink.parse(code) {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            notice = nil
            onLink(link)
        } else {
            show(notice: "That isn't an ARGraphics code")
        }
    }

    private func show(notice text: String) {
        notice = text
        noticeTask?.cancel()
        noticeTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { notice = nil }
        }
    }
}

struct ManualCodeSheet: View {
    let onClose: () -> Void
    let onSubmit: (ScanLink) -> Void
    @State private var code = ""
    @FocusState private var focused: Bool

    private var link: ScanLink? { ScanLink.parseTyped(code) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .top) {
                Text("Type the code")
                    .font(Typography.h5)
                    .foregroundStyle(.white)
                    .padding(.top, 12)
                Spacer()
                SheetCloseButton(action: onClose)
            }
            Text("It's printed under the QR code.")
                .font(Typography.bodySmall)
                .foregroundStyle(Palette.textMuted)
            TextField("k7m2qx9a", text: $code)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.go)
                .focused($focused)
                .font(.system(size: 18, weight: .medium, design: .monospaced))
                .padding(14)
                .frame(minHeight: Spacing.touch)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(focused ? Palette.violet : Palette.line, lineWidth: focused ? 2 : 1))
                .onSubmit { if let link { onSubmit(link) } }
                .accessibilityLabel("Code")
            CTAButton(title: "Open", kind: .primary) { if let link { onSubmit(link) } }
                .disabled(link == nil)
        }
        .padding(Spacing.l)
        .onAppear { focused = true }
    }
}
