import CryptoKit
import Foundation

enum AssetError: LocalizedError {
    case download
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .download: return "This didn't download. Check your connection and try again."
        case .tooLarge: return "This is too large to open on the go."
        }
    }
}

/// Downloads 3D model files once and keeps them in Caches, keyed by URL.
/// RealityKit can only load USDZ from a local file.
actor AssetCache {
    static let shared = AssetCache()

    static let maxBytes: Int64 = 150 * 1024 * 1024

    private let directory: URL
    private let session: URLSession
    private var inFlight: [URL: Task<URL, Error>] = [:]

    init(directory: URL? = nil, session: URLSession = .shared) {
        self.directory = directory
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "models")
        self.session = session
    }

    func localFile(for remote: URL) async throws -> URL {
        let destination = directory.appending(path: Self.fileName(for: remote))
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        if let task = inFlight[remote] { return try await task.value }

        let task = Task { [directory, session] () throws -> URL in
            let (temp, response) = try await session.download(from: remote)
            defer { try? FileManager.default.removeItem(at: temp) }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw AssetError.download }
            let size = (try? FileManager.default.attributesOfItem(atPath: temp.path)[.size] as? Int64) ?? 0
            guard size > 0 else { throw AssetError.download }
            guard size <= Self.maxBytes else { throw AssetError.tooLarge }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: temp, to: destination)
            return destination
        }
        inFlight[remote] = task
        defer { inFlight[remote] = nil }
        do {
            return try await task.value
        } catch let error as AssetError {
            throw error
        } catch {
            throw AssetError.download
        }
    }

    static func fileName(for url: URL) -> String {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        // RealityKit picks the loader from the extension; public model URLs are USDZ.
        return "\(digest).usdz"
    }
}
