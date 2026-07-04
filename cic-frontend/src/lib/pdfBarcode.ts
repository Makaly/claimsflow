import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'

/**
 * Stamps a barcode onto every page of a PDF document.
 * The barcode appears in the top-right corner in red, matching CIC format.
 * Returns a new object URL for the stamped PDF.
 */
export async function stampBarcodeOnPdf(
  pdfBytes: ArrayBuffer,
  barcode: string,
): Promise<{ url: string; bytes: Uint8Array }> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const pages = pdfDoc.getPages()

  const fontSize = 11
  const textWidth = font.widthOfTextAtSize(barcode, fontSize)
  const padding = 10

  for (const page of pages) {
    const { width, height } = page.getSize()

    // Draw white background rectangle behind barcode for visibility
    page.drawRectangle({
      x: width - textWidth - padding * 2 - 5,
      y: height - fontSize - padding * 2,
      width: textWidth + padding * 2 + 5,
      height: fontSize + padding * 2,
      color: rgb(1, 1, 1),
      opacity: 0.85,
    })

    // Draw red border
    page.drawRectangle({
      x: width - textWidth - padding * 2 - 5,
      y: height - fontSize - padding * 2,
      width: textWidth + padding * 2 + 5,
      height: fontSize + padding * 2,
      borderColor: rgb(0.8, 0, 0),
      borderWidth: 1,
      opacity: 1,
    })

    // Draw the barcode text in red
    page.drawText(barcode, {
      x: width - textWidth - padding - 2,
      y: height - fontSize - padding + 2,
      size: fontSize,
      font,
      color: rgb(0.8, 0, 0),
    })

    // Also stamp at bottom-left for redundancy
    page.drawRectangle({
      x: 5,
      y: 5,
      width: textWidth + padding * 2 + 5,
      height: fontSize + padding,
      color: rgb(1, 1, 1),
      opacity: 0.85,
    })
    page.drawText(barcode, {
      x: padding,
      y: 8,
      size: fontSize - 2,
      font,
      color: rgb(0.6, 0, 0),
    })
  }

  const stampedBytes = await pdfDoc.save()
  const blob = new Blob([stampedBytes as unknown as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  return { url, bytes: stampedBytes }
}

/**
 * Stamps a barcode onto an image by rendering it on a canvas
 * and returning a new object URL.
 */
export async function stampBarcodeOnImage(
  imageUrl: string,
  barcode: string,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!

      // Draw original image
      ctx.drawImage(img, 0, 0)

      // Configure barcode text
      const fontSize = Math.max(14, Math.round(img.width / 50))
      ctx.font = `bold ${fontSize}px monospace`
      const textWidth = ctx.measureText(barcode).width
      const padding = 8

      // Top-right: white bg + red text
      const x = img.width - textWidth - padding * 2 - 10
      const y = 10
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(x, y, textWidth + padding * 2, fontSize + padding * 2)
      ctx.strokeStyle = 'rgba(200,0,0,1)'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, textWidth + padding * 2, fontSize + padding * 2)
      ctx.fillStyle = 'rgb(200,0,0)'
      ctx.fillText(barcode, x + padding, y + fontSize + padding - 2)

      // Bottom-left
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(5, img.height - fontSize - padding * 2 - 5, textWidth + padding * 2, fontSize + padding)
      ctx.fillStyle = 'rgb(150,0,0)'
      ctx.font = `bold ${fontSize - 2}px monospace`
      ctx.fillText(barcode, 5 + padding, img.height - padding - 5)

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob))
        } else {
          resolve(imageUrl)
        }
      }, 'image/png')
    }
    img.onerror = () => resolve(imageUrl)
    img.src = imageUrl
  })
}

/**
 * Splits a multi-invoice PDF into separate PDFs by page range,
 * then stamps each split PDF with its own barcode.
 *
 * @param pdfBytes - the original PDF bytes
 * @param invoices - array of { barcode, pageRange } for each invoice
 * @returns array of { url, barcode, size } for each split+stamped PDF
 */
export async function splitAndStampPdf(
  pdfBytes: ArrayBuffer,
  invoices: Array<{ barcode: string; pageRange: string }>
): Promise<Array<{ url: string; size: number; bytes: Uint8Array }>> {
  const srcDoc = await PDFDocument.load(pdfBytes)
  const totalPages = srcDoc.getPageCount()
  const results: Array<{ url: string; size: number; bytes: Uint8Array }> = []

  for (const inv of invoices) {
    // Parse page range like "1-3" or "4"
    const parts = inv.pageRange.split('-').map(Number)
    const startPage = (parts[0] || 1) - 1  // 0-indexed
    const endPage = (parts[1] || parts[0] || 1) - 1

    // Create a new PDF with just these pages
    const splitDoc = await PDFDocument.create()
    const pageIndices: number[] = []
    for (let p = startPage; p <= Math.min(endPage, totalPages - 1); p++) {
      pageIndices.push(p)
    }

    if (pageIndices.length === 0) {
      // Fallback: use all pages
      pageIndices.push(...Array.from({ length: totalPages }, (_, i) => i))
    }

    const copiedPages = await splitDoc.copyPages(srcDoc, pageIndices)
    copiedPages.forEach(page => splitDoc.addPage(page))

    // Stamp barcode on the split PDF
    const font = await splitDoc.embedFont(StandardFonts.HelveticaBold)
    const fontSize = 11
    const textWidth = font.widthOfTextAtSize(inv.barcode, fontSize)
    const padding = 10

    for (const page of splitDoc.getPages()) {
      const { width, height } = page.getSize()

      // White background
      page.drawRectangle({
        x: width - textWidth - padding * 2 - 5,
        y: height - fontSize - padding * 2,
        width: textWidth + padding * 2 + 5,
        height: fontSize + padding * 2,
        color: rgb(1, 1, 1),
        opacity: 0.85,
      })
      // Red border
      page.drawRectangle({
        x: width - textWidth - padding * 2 - 5,
        y: height - fontSize - padding * 2,
        width: textWidth + padding * 2 + 5,
        height: fontSize + padding * 2,
        borderColor: rgb(0.8, 0, 0),
        borderWidth: 1,
      })
      // Red barcode text
      page.drawText(inv.barcode, {
        x: width - textWidth - padding - 2,
        y: height - fontSize - padding + 2,
        size: fontSize,
        font,
        color: rgb(0.8, 0, 0),
      })
      // Bottom-left stamp
      page.drawRectangle({
        x: 5, y: 5,
        width: textWidth + padding * 2 + 5,
        height: fontSize + padding,
        color: rgb(1, 1, 1),
        opacity: 0.85,
      })
      page.drawText(inv.barcode, {
        x: padding, y: 8,
        size: fontSize - 2,
        font,
        color: rgb(0.6, 0, 0),
      })
    }

    const savedBytes = await splitDoc.save()
    const bytes = new Uint8Array(savedBytes as unknown as ArrayBuffer)
    const blob = new Blob([bytes], { type: 'application/pdf' })
    results.push({
      url: URL.createObjectURL(blob),
      size: bytes.length,
      bytes,
    })
  }

  return results
}
