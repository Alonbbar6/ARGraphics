import AVKit
import SwiftUI

enum ShareMoment: Identifiable {
    case photo(UIImage)
    case clip(URL)

    var id: String {
        switch self {
        case .photo(let image): return "photo-\(ObjectIdentifier(image).hashValue)"
        case .clip(let url): return url.absoluteString
        }
    }

    var activityItems: [Any] {
        switch self {
        case .photo(let image): return [image]
        case .clip(let url): return [url]
        }
    }
}

/// Preview of the captured photo or clip, a Photo / Clip switch, and the system share sheet
/// (Instagram and TikTok show up there when installed).
struct ShareMomentSheet: View {
    let moment: ShareMoment
    let venueName: String
    let canRecordClip: Bool
    let onRecordClip: () -> Void
    let onClose: () -> Void

    @State private var showActivity = false

    private var isClip: Bool {
        if case .clip = moment { return true }
        return false
    }

    var body: some View {
        VStack(spacing: Spacing.m) {
            HStack {
                Text(isClip ? "Your clip" : "Your photo")
                    .font(Typography.h5)
                    .foregroundStyle(.white)
                Spacer()
                SheetCloseButton(action: onClose)
            }

            preview
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.line))

            if canRecordClip || isClip {
                modePicker
            }

            CTAButton(title: "Share to your story", systemImage: "square.and.arrow.up", kind: .primary) {
                showActivity = true
            }
            Text("Tagged “\(Watermark.text(venue: venueName))” so friends know where to find it.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(Spacing.l)
        .sheet(isPresented: $showActivity) {
            ShareSheet(items: moment.activityItems)
                .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder private var preview: some View {
        switch moment {
        case .photo(let image):
            Image(uiImage: image).resizable().scaledToFit()
                .accessibilityLabel("Photo from \(venueName)")
        case .clip(let url):
            VideoPlayer(player: AVPlayer(url: url))
                .accessibilityLabel("Clip from \(venueName)")
        }
    }

    private var modePicker: some View {
        HStack(spacing: 4) {
            pickerButton("Photo", selected: !isClip) {
                // Going back to a photo means closing and tapping the shutter again.
                if isClip { onClose() }
            }
            pickerButton("Clip", selected: isClip) {
                if !isClip { onRecordClip() }
            }
        }
        .padding(4)
        .background(Color.white.opacity(0.08), in: Capsule())
    }

    private func pickerButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(minWidth: 88, minHeight: Spacing.touch)
                .background(selected ? Palette.violet : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(title == "Clip" && !selected ? "Records a 6 second clip of the AR view" : "")
    }
}
