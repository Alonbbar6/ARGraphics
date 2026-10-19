import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/**
 * What a printed spot code carries: the public scan link, for example
 * https://argraphics.app/s/k7m2x9qp. With the ARGraphics iOS app installed the
 * link opens the app (universal link, see public/.well-known/apple-app-site-association);
 * without it, the /s/:code page offers the App Store.
 */
export function scanUrl(origin: string, path: string) {
  const cleanOrigin = origin.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(cleanOrigin)) throw new Error("The site address must be an http(s) origin.");
  if (!/^\/s\/[a-z0-9]{6,16}$/.test(path)) throw new Error("The scan path must look like /s/abc123.");
  return `${cleanOrigin}${path}`;
}

export const MAX_SPOTS_PER_BATCH = 60;
export const MAX_LABEL_LENGTH = 40;

/** "Table", 1, 12 → Table 1 … Table 12 (inclusive, capped at 60 spots). */
export function numberedLabels(prefix: string, from: number, to: number) {
  const start = Math.max(1, Math.floor(Number.isFinite(from) ? from : 1));
  const end = Math.max(start, Math.floor(Number.isFinite(to) ? to : start));
  const count = Math.min(MAX_SPOTS_PER_BATCH, end - start + 1);
  const cleanPrefix = prefix.trim();
  return Array.from({ length: count }, (_, index) =>
    `${cleanPrefix ? `${cleanPrefix} ` : ""}${start + index}`.slice(0, MAX_LABEL_LENGTH));
}

/** One label per line or comma; trimmed, de-duplicated, capped. */
export function parseLabelList(text: string) {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const label = raw.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length === MAX_SPOTS_PER_BATCH) break;
  }
  return labels;
}

/** High error correction keeps codes scannable on scuffed or glossy table tents. */
export function qrSvg(payload: string) {
  return QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "H", margin: 1, color: { dark: "#0B0B14", light: "#FFFFFF" } });
}

export function qrPngDataUrl(payload: string, size = 1024) {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "H", margin: 2, width: size, color: { dark: "#0B0B14", light: "#FFFFFF" } });
}

export type PrintTemplate = "tent" | "sticker" | "poster" | "window";

export const PRINT_TEMPLATES: { value: PrintTemplate; label: string; size: string; note: string }[] = [
  { value: "tent", label: "Table tent", size: "Letter, 2 per page", note: "Fold on the dashed line and stand it on the table." },
  { value: "sticker", label: "Window sticker", size: "5 × 5 in, 1 per page", note: "Faces the street so people walking by stop and scan." },
  { value: "poster", label: "Poster", size: "11 × 17 in, 1 per page", note: "For a wall, the host stand or an event night." },
  { value: "window", label: "Window card", size: "Letter, 1 per page", note: "Laminate it for the service window or the menu board. Says what to do in one line." },
];

export type PrintCode = { label: string; url: string; displayTitle?: string | null };

const MIDNIGHT: [number, number, number] = [11, 11, 20];
const VIOLET: [number, number, number] = [109, 40, 217];
const ORCHID: [number, number, number] = [168, 85, 247];
const CORAL: [number, number, number] = [244, 63, 94];
const TANGERINE: [number, number, number] = [251, 146, 60];
const SPOTLIGHT: [number, number, number] = [253, 230, 138];

function brandStripe(pdf: jsPDF, x: number, y: number, width: number, height: number) {
  const colors = [VIOLET, ORCHID, CORAL, TANGERINE, SPOTLIGHT];
  const step = width / colors.length;
  colors.forEach((color, index) => {
    pdf.setFillColor(...color);
    pdf.rect(x + index * step, y, step + 0.2, height, "F");
  });
}

function fit(pdf: jsPDF, text: string, maxWidth: number) {
  let value = text;
  while (value.length > 1 && pdf.getTextWidth(value) > maxWidth) value = value.slice(0, -1);
  return value === text ? value : `${value.slice(0, -1)}…`;
}

/** A table tent: two per US Letter page, the front panel below a dashed fold. */
async function drawTent(pdf: jsPDF, venue: string, code: PrintCode, slot: number) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const half = pdf.internal.pageSize.getHeight() / 2;
  const top = slot * half;
  const panel = half / 2;
  const fold = top + panel;
  const margin = 12;

  // Back panel prints upside down so it reads correctly once folded.
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(...VIOLET);
  pdf.text(fit(pdf, venue, pageWidth - margin * 2), pageWidth / 2, fold - panel / 2 - 4, { align: "center", angle: 180 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(90);
  pdf.text("Scan the code on the other side with the ARGraphics app", pageWidth / 2, fold - panel / 2 + 6, { align: "center", angle: 180 });

  pdf.setDrawColor(170);
  pdf.setLineDashPattern([2, 2], 0);
  pdf.line(margin, fold, pageWidth - margin, fold);
  if (slot === 0) pdf.line(0, half, pageWidth, half);
  pdf.setLineDashPattern([], 0);

  const qrSize = panel - 16;
  const qrX = margin + 4;
  const qrY = fold + 8;
  pdf.addImage(await qrPngDataUrl(code.url, 640), "PNG", qrX, qrY, qrSize, qrSize);
  brandStripe(pdf, qrX + qrSize + 10, qrY, 26, 2);

  const textX = qrX + qrSize + 10;
  const textWidth = pageWidth - textX - margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...VIOLET);
  pdf.text(fit(pdf, venue.toUpperCase(), textWidth), textX, qrY + 10);
  pdf.setFontSize(22);
  pdf.setTextColor(...MIDNIGHT);
  pdf.text(fit(pdf, "Point. Scan. Look up.", textWidth), textX, qrY + 21);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10.5);
  pdf.setTextColor(70);
  const lines = pdf.splitTextToSize(
    code.displayTitle ? `${code.displayTitle} is waiting at this table. Open the ARGraphics app and scan to see it.` : "Something is waiting at this table. Open the ARGraphics app and scan to see it.",
    textWidth,
  ) as string[];
  pdf.text(lines.slice(0, 3), textX, qrY + 30);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...MIDNIGHT);
  pdf.text(fit(pdf, code.label, textWidth), textX, qrY + qrSize - 2);
}

/** A 5 × 5 in window sticker on Midnight with a white QR well. */
async function drawSticker(pdf: jsPDF, venue: string, code: PrintCode) {
  const size = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...MIDNIGHT);
  pdf.rect(0, 0, size, size, "F");
  brandStripe(pdf, 0, size - 4, size, 4);
  const well = size * 0.56;
  const wellX = (size - well) / 2;
  const wellY = 26;
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(wellX - 3, wellY - 3, well + 6, well + 6, 3, 3, "F");
  pdf.addImage(await qrPngDataUrl(code.url, 720), "PNG", wellX, wellY, well, well);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(...SPOTLIGHT);
  pdf.text(fit(pdf, venue.toUpperCase(), size - 20), size / 2, 15, { align: "center" });
  pdf.setFontSize(15);
  pdf.setTextColor(255, 255, 255);
  pdf.text("Something's here you can only see inside.", size / 2, wellY + well + 13, { align: "center", maxWidth: size - 16 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(210, 205, 235);
  pdf.text(`Scan with the ARGraphics app · ${fit(pdf, code.label, size / 2)}`, size / 2, wellY + well + 21, { align: "center" });
}

/** An 11 × 17 in poster: big headline, big code. */
async function drawPoster(pdf: jsPDF, venue: string, code: PrintCode) {
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 22;
  pdf.setFillColor(...MIDNIGHT);
  pdf.rect(0, 0, width, height, "F");
  brandStripe(pdf, 0, 0, width, 6);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(...SPOTLIGHT);
  pdf.text(fit(pdf, venue.toUpperCase(), width - margin * 2), margin, 30);
  pdf.setFontSize(44);
  pdf.setTextColor(255, 255, 255);
  const headline = pdf.splitTextToSize(code.displayTitle || "There's something here you can only see in the room.", width - margin * 2) as string[];
  pdf.text(headline.slice(0, 3), margin, 54);
  const qr = 150;
  const qrX = (width - qr) / 2;
  const qrY = 54 + Math.min(3, headline.length) * 17 + 14;
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(qrX - 6, qrY - 6, qr + 12, qr + 12, 4, 4, "F");
  pdf.addImage(await qrPngDataUrl(code.url, 1024), "PNG", qrX, qrY, qr, qr);
  pdf.setFontSize(22);
  pdf.setTextColor(...CORAL);
  pdf.text("Scan it with the ARGraphics app.", width / 2, qrY + qr + 24, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(13);
  pdf.setTextColor(210, 205, 235);
  pdf.text("Free on the App Store. Point your phone at this poster and look up.", width / 2, qrY + qr + 35, { align: "center", maxWidth: width - margin * 2 });
  pdf.setFontSize(11);
  pdf.text(fit(pdf, code.label, width - margin * 2), width / 2, height - 18, { align: "center" });
}

/**
 * A window card: US Letter, one code, built to be read from a line. The venue name on top, a
 * big code, and one instruction. Made for a food truck's service window or a menu board.
 */
async function drawWindowCard(pdf: jsPDF, venue: string, code: PrintCode) {
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 18;
  pdf.setFillColor(...MIDNIGHT);
  pdf.rect(0, 0, width, height, "F");
  brandStripe(pdf, 0, 0, width, 5);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(...SPOTLIGHT);
  pdf.text(fit(pdf, venue.toUpperCase(), width - margin * 2), width / 2, 34, { align: "center" });
  pdf.setFontSize(34);
  pdf.setTextColor(255, 255, 255);
  const headline = pdf.splitTextToSize(code.displayTitle || "See the menu in 3D, right in front of you.", width - margin * 2) as string[];
  pdf.text(headline.slice(0, 2), width / 2, 56, { align: "center" });
  const qr = 120;
  const qrX = (width - qr) / 2;
  const qrY = 56 + Math.min(2, headline.length) * 14 + 10;
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(qrX - 6, qrY - 6, qr + 12, qr + 12, 5, 5, "F");
  pdf.addImage(await qrPngDataUrl(code.url, 1024), "PNG", qrX, qrY, qr, qr);
  pdf.setFontSize(24);
  pdf.setTextColor(...CORAL);
  pdf.text("Point your camera at the code.", width / 2, qrY + qr + 22, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(14);
  pdf.setTextColor(210, 205, 235);
  pdf.text("No app needed. Tap a dish, turn it around, set it down in front of you.", width / 2, qrY + qr + 32, { align: "center", maxWidth: width - margin * 2 });
  pdf.setFontSize(11);
  pdf.text(fit(pdf, code.label, width - margin * 2), width / 2, height - 16, { align: "center" });
}

/** Builds a print-ready PDF of every code in the chosen template. */
export async function createQrPrintPdf(template: PrintTemplate, venueName: string, codes: PrintCode[]) {
  if (codes.length === 0) throw new Error("Add at least one spot.");
  const venue = venueName.trim() || "ARGraphics";
  const pdf = template === "sticker"
    ? new jsPDF({ unit: "mm", format: [127, 127], compress: true })
    : template === "poster"
      ? new jsPDF({ unit: "mm", format: [279.4, 431.8], compress: true })
      : new jsPDF({ unit: "mm", format: "letter", compress: true });
  pdf.setProperties({ title: `${venue} ARGraphics codes`, creator: "ARGraphics" });

  for (let index = 0; index < codes.length; index += 1) {
    if (template === "tent") {
      const slot = index % 2;
      if (index > 0 && slot === 0) pdf.addPage();
      await drawTent(pdf, venue, codes[index], slot);
    } else {
      if (index > 0) pdf.addPage();
      if (template === "sticker") await drawSticker(pdf, venue, codes[index]);
      else if (template === "window") await drawWindowCard(pdf, venue, codes[index]);
      else await drawPoster(pdf, venue, codes[index]);
    }
  }
  return pdf;
}

export function fileSafe(value: string, fallback = "argraphics") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}
