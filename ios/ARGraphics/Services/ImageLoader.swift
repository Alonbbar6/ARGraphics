import UIKit

/// Downloads display artwork (art pieces, posters, offer cards) for AR panels and share images.
/// Keeps a small in-memory cache so the AR view and the card share one download.
actor ImageLoader {
    static let shared = ImageLoader()

    static let maxBytes = 25 * 1024 * 1024

    private let session: URLSession
    private let cache = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<UIImage, Error>] = [:]

    init(session: URLSession = .shared) {
        self.session = session
        cache.countLimit = 24
    }

    func image(for url: URL) async throws -> UIImage {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        if let task = inFlight[url] { return try await task.value }
        let task = Task { [session] () throws -> UIImage in
            let (data, response) = try await session.data(from: url)
            if let http = response as? HTTPURLResponse, http.statusCode != 200 { throw AssetError.download }
            guard data.count <= Self.maxBytes, let image = UIImage(data: data) else { throw AssetError.download }
            // Decode now, off the main thread, so the first frame doesn't stutter.
            return await image.byPreparingForDisplay() ?? image
        }
        inFlight[url] = task
        defer { inFlight[url] = nil }
        let image = try await task.value
        cache.setObject(image, forKey: url as NSURL)
        return image
    }
}
