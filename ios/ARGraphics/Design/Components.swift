import SwiftUI
import UIKit

// MARK: - Buttons

/// 150ms press-to-0.98 from the micro-interaction spec. Reduce Motion dims instead of scaling.
struct PressScaleStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed && reduceMotion ? 0.8 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

enum CTAKind { case hero, primary, outline }

struct CTAButton: View {
    let title: String
    var systemImage: String?
    var kind: CTAKind = .primary
    var isLoading = false
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.s) {
                if isLoading {
                    ProgressView().tint(.white)
                } else if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
            }
            .font(Typography.button)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: Spacing.touch)
            .background { background }
            .overlay { if kind == .hero && isEnabled && !isLoading { Shimmer() } }
            .clipShape(Capsule())
            .overlay {
                if kind == .outline { Capsule().strokeBorder(Color.white.opacity(0.85), lineWidth: 1.5) }
            }
            .shadow(color: kind == .hero ? Palette.coral.opacity(0.45) : .clear, radius: 18, y: 6)
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Capsule())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(isLoading)
    }

    @ViewBuilder private var background: some View {
        switch kind {
        case .hero: Palette.heroGradient
        case .primary: Palette.violet
        case .outline: Color.clear
        }
    }
}

/// Slow light sweep across the hero button. Off under Reduce Motion.
private struct Shimmer: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { proxy in
            if !reduceMotion {
                LinearGradient(colors: [.clear, .white.opacity(0.28), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: proxy.size.width * 0.45)
                    .rotationEffect(.degrees(18))
                    .offset(x: phase * proxy.size.width * 1.4)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 2.6).delay(0.6).repeatForever(autoreverses: false)) { phase = 1 }
                    }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct CircleIconButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.18)))
                .frame(width: Spacing.touch, height: Spacing.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel(label)
    }
}

/// The visible close control every sheet carries (48pt target).
struct SheetCloseButton: View {
    var label = "Close"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Color.white.opacity(0.14), in: Circle())
                .frame(width: Spacing.touch, height: Spacing.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel(label)
    }
}

// MARK: - Chips & labels

struct Eyebrow: View {
    let text: String
    var color: Color = Palette.tangerine
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 9, weight: .bold)) }
            Text(text.uppercased())
        }
        .font(Typography.eyebrow)
        .tracking(1.1)
        .foregroundStyle(Palette.midnight)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color, in: Capsule())
    }
}

struct BrandMark: View {
    var trailing: String?

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3)
                .fill(Palette.brandGradient)
                .frame(width: 12, height: 12)
            Text("ARGRAPHICS").font(.system(size: 11, weight: .bold)).tracking(1.2)
            if let trailing {
                Text("· \(trailing)").font(.system(size: 11, weight: .medium))
            }
        }
        .foregroundStyle(Palette.textMuted)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(trailing.map { "ARGraphics, \($0)" } ?? "ARGraphics")
    }
}

/// "● Tuesday Birria Tower  $14" floating label over AR content.
struct PriceChip: View {
    let name: String
    let price: String?

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Palette.coral).frame(width: 7, height: 7)
            Text(name).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
            if let price {
                Text(price).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.tangerine)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))
        .accessibilityElement(children: .combine)
    }
}

struct StatusPill: View {
    let text: String
    var showsSpinner = false
    var systemImage: String?

    var body: some View {
        HStack(spacing: 8) {
            if showsSpinner { ProgressView().controlSize(.small).tint(Palette.orchid) }
            if let systemImage { Image(systemName: systemImage) }
            Text(text)
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.15)))
    }
}

/// Muted explainer box, e.g. "Camera is off, so you're seeing the flat version."
struct NoticeBox: View {
    let systemImage: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(Typography.bodySmall)
        .foregroundStyle(Palette.textMuted)
        .padding(12)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.line))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Scan reticle

/// Pulsing violet ring with a dashed inner track (design: scale 0.96→1.04, opacity 0.6→1, 1.2s loop).
/// Reduce Motion keeps only the opacity pulse.
struct ScanReticle: View {
    var tight = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 36)
                .strokeBorder(Palette.violet, lineWidth: 3)
                .shadow(color: Palette.violet.opacity(0.9), radius: 16)
            RoundedRectangle(cornerRadius: 36)
                .strokeBorder(Palette.orchid.opacity(0.7), lineWidth: 1)
            RoundedRectangle(cornerRadius: 28)
                .strokeBorder(Palette.orchid.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [4, 6]))
                .padding(14)
        }
        .scaleEffect(reduceMotion ? 1 : (tight ? 0.9 : (pulse ? 1.04 : 0.96)))
        .opacity(pulse ? 1 : 0.6)
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.7), value: tight)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Backgrounds

/// Dim-bar bokeh used behind non-camera screens.
struct BokehBackground: View {
    var body: some View {
        ZStack {
            Palette.midnight
            Circle().fill(Palette.violet.opacity(0.55)).frame(width: 260).blur(radius: 90).offset(x: -120, y: -260)
            Circle().fill(Palette.coral.opacity(0.35)).frame(width: 220).blur(radius: 90).offset(x: 140, y: -60)
            Circle().fill(Palette.tangerine.opacity(0.25)).frame(width: 240).blur(radius: 100).offset(x: -80, y: 260)
            Circle().fill(Palette.orchid.opacity(0.3)).frame(width: 160).blur(radius: 70).offset(x: 150, y: 330)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

// MARK: - Sheet card

struct SheetCard<Content: View>: View {
    var onClose: (() -> Void)?
    var closeLabel = "Close"
    /// Extra room for the home indicator when the card runs to the screen edge.
    var bottomInset: CGFloat = 0
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Capsule().fill(Color.white.opacity(0.3)).frame(width: 40, height: 5)
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)
            content
        }
        .padding(.horizontal, Spacing.l)
        .padding(.top, 10)
        .padding(.bottom, Spacing.l + bottomInset)
        .background(
            LinearGradient(colors: [Palette.sheet, Palette.indigo], startPoint: .top, endPoint: .bottom),
            in: UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
        )
        .overlay(alignment: .topTrailing) {
            if let onClose {
                SheetCloseButton(label: closeLabel, action: onClose).padding(4)
            }
        }
    }
}

struct ErrorStateView: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: Spacing.m) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 34))
                .foregroundStyle(Palette.orchid)
            Text(message)
                .font(Typography.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.textMuted)
            if let retry {
                CTAButton(title: "Try again", kind: .primary, action: retry).frame(maxWidth: 240)
            }
        }
        .padding(Spacing.l)
    }
}

// MARK: - Media

/// Artwork from the API, loaded through ImageLoader. Shows a soft placeholder until ready.
struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    var placeholderSymbol = "sparkles"

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            LinearGradient(colors: [Palette.indigo, Palette.violet.opacity(0.6)], startPoint: .top, endPoint: .bottom)
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Image(systemName: placeholderSymbol).font(.system(size: 24)).foregroundStyle(.white.opacity(0.6))
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            image = try? await ImageLoader.shared.image(for: url)
        }
        .accessibilityHidden(true)
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

func openAppSettings() {
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
}
