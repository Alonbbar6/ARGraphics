import SwiftUI

/// Offer card: title in H3, Tangerine accents, live countdown, and Claim as the one Coral action.
struct OfferCard: View {
    let model: ExperienceModel
    let offer: PublicOffer
    let onClaim: () -> Void
    let onShowClaim: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Eyebrow(text: eyebrow, color: Palette.tangerine)
            Text(offer.title)
                .font(Typography.h3)
                .foregroundStyle(.white)
                .lineSpacing(4)
                .minimumScaleFactor(0.75)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !offer.details.isEmpty {
                Text(offer.details)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let endsAt = offer.endsAt {
                OfferCountdown(endsAt: endsAt)
            }
            action
        }
    }

    private var eyebrow: String {
        guard let endsAt = offer.endsAt else { return "Offer" }
        return Calendar.current.isDateInToday(endsAt) ? "Tonight only" : "Offer"
    }

    @ViewBuilder private var action: some View {
        switch model.claimState {
        case .ended:
            NoticeBox(systemImage: "clock.badge.xmark", text: "This offer has ended.")
        case .claimed:
            CTAButton(title: "Show my claim", systemImage: "checkmark.seal", kind: .primary, action: onShowClaim)
        case .idle, .claiming, .failed:
            if case .failed(let message) = model.claimState {
                NoticeBox(systemImage: "exclamationmark.circle", text: message)
            }
            if Countdown.isExpired(offer.endsAt, now: .now) {
                NoticeBox(systemImage: "clock.badge.xmark", text: "This offer has ended.")
            } else {
                CTAButton(title: "Claim", kind: .hero, isLoading: model.claimState == .claiming, action: onClaim)
                Text("Claim it, then show your phone to your server. One per guest a day.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textMuted)
            }
        }
    }
}

/// "Ends at 10:00 PM · 01:42:10", ticking every second.
struct OfferCountdown: View {
    let endsAt: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = endsAt.timeIntervalSince(context.date)
            HStack(spacing: 12) {
                Image(systemName: "clock").font(.system(size: 18, weight: .semibold))
                VStack(alignment: .leading, spacing: 2) {
                    Text(Countdown().offerEnds(endsAt))
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textMuted)
                    Text(remaining > 0 ? Countdown.clock(remaining) : "Ended")
                        .font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Palette.tangerine)
                }
                Spacer()
            }
            .foregroundStyle(Palette.tangerine)
            .padding(14)
            .background(Palette.tangerine.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.tangerine.opacity(0.55)))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(remaining > 0
                ? "\(Countdown().offerEnds(endsAt)). \(Countdown.clock(remaining)) left."
                : "This offer has ended.")
        }
    }
}

/// Staff-facing confirmation. Success green with Midnight text, a big code, and a live clock
/// whose seconds keep ticking so staff can tell it isn't a screenshot.
struct ClaimConfirmedView: View {
    let claim: Claim
    let backTitle: String
    let onBack: () -> Void

    @State private var pulse = false

    var body: some View {
        VStack(spacing: Spacing.m) {
            Text("Show this to your server")
                .font(Typography.bodySmall)
                .foregroundStyle(Palette.textMuted)

            TimelineView(.periodic(from: .now, by: 1)) { context in
                let expired = context.date >= claim.expiresAt
                VStack(spacing: Spacing.m) {
                    panel(expired: expired)
                    VStack(spacing: 6) {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(expired ? Palette.error : Palette.success)
                                .frame(width: 8, height: 8)
                                .opacity(pulse ? 1 : 0.35)
                            Text(Countdown().claimLine(claimedAt: claim.claimedAt, expiresAt: claim.expiresAt, now: context.date))
                                .monospacedDigit()
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        Text("Now \(Countdown().timeWithSeconds(context.date))")
                            .font(.system(size: 15, weight: .medium).monospacedDigit())
                            .foregroundStyle(Palette.textMuted)
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            Text("The seconds keep ticking so staff know it isn't a screenshot.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textMuted)
                .multilineTextAlignment(.center)

            CTAButton(title: backTitle, kind: .outline, action: onBack)
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) { pulse = true }
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    private func panel(expired: Bool) -> some View {
        VStack(spacing: 12) {
            Image(systemName: expired ? "xmark" : "checkmark")
                .font(.system(size: 26, weight: .heavy))
                .foregroundStyle(expired ? Palette.error : Palette.success)
                .frame(width: 56, height: 56)
                .background(Palette.midnight, in: Circle())
                .accessibilityHidden(true)
            Text(expired ? "Expired" : "Confirmed")
                .font(Typography.display(44))
                .accessibilityAddTraits(.isHeader)
            Text([claim.offerTitle, claim.spotLabel].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 16, weight: .semibold))
                .multilineTextAlignment(.center)
            Text(claim.confirmationCode)
                .font(.system(size: 30, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .background(Palette.midnight, in: Capsule())
                .textSelection(.enabled)
                .accessibilityLabel("Code \(claim.confirmationCode.map(String.init).joined(separator: " "))")
        }
        .foregroundStyle(Palette.midnight)
        .padding(.vertical, Spacing.l)
        .padding(.horizontal, Spacing.m)
        .frame(maxWidth: .infinity)
        .background(expired ? Palette.textMuted : Palette.success, in: RoundedRectangle(cornerRadius: 20))
    }
}
