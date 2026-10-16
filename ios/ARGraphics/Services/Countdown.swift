import Foundation

/// Text for offer countdowns, claim confirmations and walking distances.
/// Pure functions of `now` so they can be tested and driven by a ticking clock.
struct Countdown {
    var timeZone: TimeZone = .current
    var locale: Locale = .current

    /// `14:52` under an hour, `01:42:10` from an hour up. Never negative.
    static func clock(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 { return String(format: "%02d:%02d:%02d", hours, minutes, secs) }
        return String(format: "%02d:%02d", minutes, secs)
    }

    /// `8:14 PM` in the guest's locale.
    func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("jmm")
        return Self.plainSpaces(formatter.string(from: date))
    }

    /// `8:14:03 PM`, the live clock on the staff-facing confirmation.
    func timeWithSeconds(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("jmmss")
        return Self.plainSpaces(formatter.string(from: date))
    }

    /// `Claimed 8:14 PM · valid for 14:52`, or `Claimed 8:14 PM · expired 8:29 PM`.
    func claimLine(claimedAt: Date, expiresAt: Date, now: Date) -> String {
        let claimed = "Claimed \(time(claimedAt))"
        if now >= expiresAt { return "\(claimed) · expired \(time(expiresAt))" }
        return "\(claimed) · valid for \(Self.clock(expiresAt.timeIntervalSince(now)))"
    }

    /// `Ends at 10:00 PM`, plus the time left as a separate ticking value.
    func offerEnds(_ endsAt: Date) -> String {
        "Ends at \(time(endsAt))"
    }

    /// Recent ICU puts a narrow no-break space before AM/PM; keep plain spaces so text
    /// matches the design and wraps predictably.
    private static func plainSpaces(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{202F}", with: " ")
    }

    static func isExpired(_ date: Date?, now: Date) -> Bool {
        guard let date else { return false }
        return now >= date
    }

    /// Roughly 80 m a minute, rounded up: `3 min walk`.
    static func walk(meters: Int) -> String {
        let minutes = max(1, Int((Double(max(0, meters)) / 80).rounded(.up)))
        return "\(minutes) min walk"
    }
}
