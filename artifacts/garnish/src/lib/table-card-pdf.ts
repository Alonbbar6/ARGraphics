import { jsPDF } from "jspdf";

/** Build the same card-sized, full-bleed PDF used by the download button. */
export function createTableCardPdf(
  imageData: string,
  physicalWidthCm: number,
  artworkWidthPx: number,
  artworkHeightPx: number,
) {
  if (![physicalWidthCm, artworkWidthPx, artworkHeightPx].every(
    (value) => Number.isFinite(value) && value > 0,
  ) || physicalWidthCm > 100) {
    throw new Error("The artwork dimensions and printed width must be valid.");
  }
  const widthMm = physicalWidthCm * 10;
  const heightMm = widthMm * artworkHeightPx / artworkWidthPx;
  const pdf = new jsPDF({
    orientation: widthMm >= heightMm ? "landscape" : "portrait",
    unit: "mm",
    format: [widthMm, heightMm],
    compress: true,
  });
  pdf.addImage(imageData, "PNG", 0, 0, widthMm, heightMm);
  return pdf;
}
