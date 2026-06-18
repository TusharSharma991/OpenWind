import PDFDocument from "pdfkit";

// Tailwind gray-200 / gray-50 — match the admin-ui table palette
const PDF_HEADER_BG = "#e5e7eb";
const PDF_ROW_ALT_BG = "#f9fafb";

export async function renderExportPdf(
  headers: string[],
  rows: string[][],
  entityName: string,
): Promise<Buffer> {
  const landscape = headers.length > 6;
  const doc = new PDFDocument({
    margin: 30,
    layout: landscape ? "landscape" : "portrait",
    size: "A4",
  });
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = landscape ? 841.89 : 595.28;
    const pageH = landscape ? 595.28 : 841.89;
    const margin = 30;
    const usableW = pageW - margin * 2;
    const colW = Math.max(Math.min(usableW / headers.length, 160), 40);
    const lineH = 14;
    const maxY = pageH - margin;

    doc.fontSize(12).font("Helvetica-Bold").text(entityName, margin, margin);
    let y = margin + 22;

    doc.rect(margin, y, usableW, lineH).fill(PDF_HEADER_BG);
    doc.fill("black").fontSize(8).font("Helvetica-Bold");
    headers.forEach((h, i) => {
      const t = h.length > 20 ? h.slice(0, 17) + "…" : h;
      doc.text(t, margin + i * colW, y + 3, {
        width: colW - 6,
        lineBreak: false,
      });
    });
    y += lineH;

    doc.font("Helvetica").fontSize(7);
    rows.forEach((row, ri) => {
      if (y + lineH > maxY) {
        doc.addPage({
          layout: landscape ? "landscape" : "portrait",
          size: "A4",
        });
        y = margin;
      }
      if (ri % 2 === 0) {
        doc.rect(margin, y, usableW, lineH).fill(PDF_ROW_ALT_BG);
      }
      doc.fill("black");
      row.forEach((cell, ci) => {
        const t = cell.length > 25 ? cell.slice(0, 22) + "…" : cell;
        doc.text(t, margin + ci * colW, y + 3, {
          width: colW - 6,
          lineBreak: false,
        });
      });
      y += lineH;
    });

    doc.end();
  });
}
