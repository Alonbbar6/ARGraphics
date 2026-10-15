import type { RequestHandler } from "express";
import type { SmokeManifest } from "../storage-smoke/safety";

/** Record before response delivery, including inside nested Express routers. */
export function trackSmokeUploads(manifest: SmokeManifest): RequestHandler {
  return (req, res, next) => {
    const trackUpload = req.path === "/api/storage/uploads/request-url";
    const json = res.json.bind(res);
    res.json = (body) => {
      if (trackUpload && res.statusCode === 200) {
        manifest.record(body.uploadURL, body.objectPath);
      }
      return json(body);
    };
    next();
  };
}
