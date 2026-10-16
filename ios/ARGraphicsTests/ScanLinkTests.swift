import Testing
@testable import ARGraphics

struct ScanLinkTests {
    @Test(arguments: [
        "https://argraphics.app/s/k7m2qx9a",
        "https://evil.example.com/s/k7m2qx9a",
        "http://localhost:5000/s/k7m2qx9a",
        "https://argraphics.app/s/k7m2qx9a/",
        "https://argraphics.app/s/k7m2qx9a?utm_source=table",
        "https://argraphics.app/s/k7m2qx9a#top",
        "HTTPS://ARGRAPHICS.APP/S/K7M2QX9A",
        "  https://argraphics.app/s/k7m2qx9a \n",
        "https://argraphics.app/app/s/k7m2qx9a",
    ])
    func webCodeLinks(_ raw: String) {
        #expect(ScanLink.parse(raw) == .code("k7m2qx9a"))
    }

    @Test func customSchemeCode() {
        #expect(ScanLink.parse("argraphics://s/k7m2qx9a") == .code("k7m2qx9a"))
        #expect(ScanLink.parse("ARGRAPHICS://S/K7M2QX9A") == .code("k7m2qx9a"))
    }

    @Test func codeLengthBounds() {
        #expect(ScanLink.parse("https://h.example/s/abc123") == .code("abc123"))
        #expect(ScanLink.parse("https://h.example/s/abcdefgh12345678") == .code("abcdefgh12345678"))
        #expect(ScanLink.parse("https://h.example/s/abc12") == nil)
        #expect(ScanLink.parse("https://h.example/s/abcdefgh123456789") == nil)
    }

    @Test func legacyVenueForms() {
        #expect(ScanLink.parse("argraphics://venue/casa-marisol") == .venue(slug: "casa-marisol"))
        #expect(ScanLink.parse("casa-marisol") == .venue(slug: "casa-marisol"))
        #expect(ScanLink.parse("  Casa-Marisol \n") == .venue(slug: "casa-marisol"))
        #expect(ScanLink.parse("https://old.example/b/casa-marisol?table=6") == .venue(slug: "casa-marisol"))
        #expect(ScanLink.parse("https://old.example/venues/casa-marisol") == .venue(slug: "casa-marisol"))
    }

    /// The link's host is never part of the result, so it can never become the API host.
    @Test func hostIsNeverTrusted() {
        let a = ScanLink.parse("https://attacker.example/s/k7m2qx9a")
        let b = ScanLink.parse("https://argraphics.app/s/k7m2qx9a")
        #expect(a == b)
        if case .code(let code) = a {
            #expect(!code.contains("attacker"))
        } else {
            Issue.record("expected a code")
        }
    }

    @Test(arguments: [
        "",
        "hello world",
        "https://example.com/",
        "https://example.com/s/",
        "https://example.com/s/k7m2-qx9a",
        "https://example.com/s/k7m2qx9a/extra",
        "https://example.com/s/../admin",
        "https://example.com/s/k7m2%20qx9a",
        "https://user:pass@example.com/s/k7m2qx9a",
        "https:///s/k7m2qx9a",
        "argraphics://other/k7m2qx9a",
        "argraphics://s/",
        "argraphics://s/k7m2qx9a/extra",
        "argraphics://bar/casa-marisol",
        "ftp://example.com/s/k7m2qx9a",
        "javascript:alert(1)",
        "file:///s/k7m2qx9a",
        "casa--marisol",
        "-casa",
        "casa marisol",
    ])
    func rejectsInvalid(_ raw: String) {
        #expect(ScanLink.parse(raw) == nil)
    }

    @Test func rejectsOversizedPayload() {
        #expect(ScanLink.parse("https://h.example/s/" + String(repeating: "a", count: 3000)) == nil)
    }

    @Test func typedEntryTriesCodeThenSlug() {
        #expect(ScanLink.parseTyped("K7M2QX9A") == .typed("k7m2qx9a"))
        #expect(ScanLink.parseTyped("casa-marisol") == .venue(slug: "casa-marisol"))
        #expect(ScanLink.parseTyped("https://h.example/s/k7m2qx9a") == .code("k7m2qx9a"))
        #expect(ScanLink.parseTyped("??") == nil)
    }

    @Test func validators() {
        #expect(ScanLink.isValidCode("abc123"))
        #expect(!ScanLink.isValidCode("ABC123"))
        #expect(ScanLink.isValidSlug(String(repeating: "a", count: 120)))
        #expect(!ScanLink.isValidSlug(String(repeating: "a", count: 121)))
    }
}
