import SwiftUI

/// Tokens from brand-design-system.md. The visitor experience is dark-only.
enum Palette {
    static let midnight = Color(hex: 0x0B0B14)
    static let indigo = Color(hex: 0x2A1B5E)
    static let violet = Color(hex: 0x6D28D9)
    static let orchid = Color(hex: 0xA855F7)
    static let coral = Color(hex: 0xF43F5E)
    static let tangerine = Color(hex: 0xFB923C)
    static let spotlight = Color(hex: 0xFDE68A)
    static let success = Color(hex: 0x22C55E)
    static let error = Color(hex: 0xDC2626)
    static let warning = Color(hex: 0xF59E0B)
    static let darkBlue = Color(hex: 0x0F172A)
    static let info = Color(hex: 0x3B82F6)

    static let textPrimary = Color.white
    static let textMuted = Color.white.opacity(0.68)
    static let sheet = Color(hex: 0x24164F)
    static let line = Color.white.opacity(0.14)

    /// Coral → Tangerine, reserved for the single hero action on a screen.
    static let heroGradient = LinearGradient(
        colors: [coral, Color(hex: 0xF9566A), tangerine],
        startPoint: .leading, endPoint: .trailing
    )
    static let brandGradient = LinearGradient(
        colors: [violet, orchid, coral, tangerine],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

enum Typography {
    /// DM Serif Display in the design system; New York is the closest system serif.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif) }
    static let h1 = display(40)
    static let h2 = display(32)
    /// Brief: H3 30/1.25 Inter. Offer titles use it.
    static let h3 = Font.system(size: 30, weight: .semibold)
    static let h5 = Font.system(size: 20, weight: .semibold)
    static let h6 = Font.system(size: 18, weight: .semibold)
    static let body = Font.system(size: 16)
    static let bodySmall = Font.system(size: 14)
    static let caption = Font.system(size: 12, weight: .medium)
    static let eyebrow = Font.system(size: 11, weight: .bold)
    static let button = Font.system(size: 17, weight: .semibold)
}

/// Springs from the brief: sheets open with a slight overshoot; Reduce Motion gets opacity only.
enum Motion {
    static func sheet(reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeInOut(duration: 0.15) : .spring(response: 0.42, dampingFraction: 0.72)
    }

    static func sheetTransition(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity)
    }
}

enum Spacing {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 16
    static let l: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 48
    static let touch: CGFloat = 48
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
