import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PdfWatermarkService {
  /**
   * Add batch number watermark to PDF
   */
  async addBatchWatermark(
    pdfPath: string,
    batchNumber: string,
    outputPath?: string,
  ): Promise<string> {
    try {
      // Read the PDF
      const existingPdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Get font
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Get all pages
      const pages = pdfDoc.getPages();

      // Add watermark to each page
      for (const page of pages) {
        const { width, height } = page.getSize();

        // Add batch number at top right corner
        page.drawText(`Batch: ${batchNumber}`, {
          x: width - 150,
          y: height - 20,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });

        // Add timestamp
        const timestamp = new Date().toISOString();
        page.drawText(`Uploaded: ${timestamp}`, {
          x: width - 200,
          y: height - 35,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
      }

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const finalOutputPath = outputPath || pdfPath.replace('.pdf', '_watermarked.pdf');
      fs.writeFileSync(finalOutputPath, pdfBytes);

      return finalOutputPath;
    } catch (error) {
      throw new Error(`Failed to add watermark: ${error.message}`);
    }
  }

  /**
   * Add barcode image to PDF
   */
  async addBarcodeToPdf(
    pdfPath: string,
    barcodeImageBuffer: Buffer,
    outputPath?: string,
  ): Promise<string> {
    try {
      const existingPdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Embed the barcode image
      const barcodeImage = await pdfDoc.embedPng(barcodeImageBuffer);

      // Get the first page
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      // Add barcode to top right corner
      const barcodeWidth = 150;
      const barcodeHeight = 50;

      firstPage.drawImage(barcodeImage, {
        x: width - barcodeWidth - 10,
        y: height - barcodeHeight - 10,
        width: barcodeWidth,
        height: barcodeHeight,
      });

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const finalOutputPath = outputPath || pdfPath.replace('.pdf', '_with_barcode.pdf');
      fs.writeFileSync(finalOutputPath, pdfBytes);

      return finalOutputPath;
    } catch (error) {
      throw new Error(`Failed to add barcode to PDF: ${error.message}`);
    }
  }

  /**
   * Add both watermark and barcode to PDF
   */
  async addWatermarkAndBarcode(
    pdfPath: string,
    batchNumber: string,
    barcodeText: string,
    barcodeImageBuffer: Buffer,
    outputPath?: string,
  ): Promise<string> {
    try {
      const existingPdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const barcodeImage = await pdfDoc.embedPng(barcodeImageBuffer);

      const pages = pdfDoc.getPages();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();

        // Add barcode only to first page
        if (i === 0) {
          const barcodeWidth = 150;
          const barcodeHeight = 50;

          page.drawImage(barcodeImage, {
            x: width - barcodeWidth - 10,
            y: height - barcodeHeight - 60,
            width: barcodeWidth,
            height: barcodeHeight,
          });
        }

        // Add batch number to all pages
        page.drawText(`Batch: ${batchNumber}`, {
          x: 10,
          y: height - 20,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });

        // Add page number
        page.drawText(`Page ${i + 1} of ${pages.length}`, {
          x: width / 2 - 30,
          y: 10,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
      }

      const pdfBytes = await pdfDoc.save();
      const finalOutputPath = outputPath || pdfPath.replace('.pdf', '_processed.pdf');
      fs.writeFileSync(finalOutputPath, pdfBytes);

      return finalOutputPath;
    } catch (error) {
      throw new Error(`Failed to process PDF: ${error.message}`);
    }
  }

  /**
   * Stamp all pages of a PDF with "APPROVED" and the claim number.
   * The stamp is a semi-transparent green box in the bottom-right corner.
   */
  async addApprovalStamp(pdfPath: string, claimNumber: string): Promise<string> {
    try {
      const existingPdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const approvedAt = new Date().toLocaleDateString('en-KE');

      for (const page of pdfDoc.getPages()) {
        const { width, height } = page.getSize();

        // Green background box
        page.drawRectangle({
          x: width - 160,
          y: 15,
          width: 145,
          height: 42,
          color: rgb(0.85, 1.0, 0.85),
          borderColor: rgb(0, 0.55, 0.2),
          borderWidth: 1.5,
        });

        // "APPROVED" text
        page.drawText('APPROVED', {
          x: width - 148,
          y: 38,
          size: 14,
          font,
          color: rgb(0, 0.45, 0.1),
        });

        // Claim number
        page.drawText(claimNumber, {
          x: width - 148,
          y: 24,
          size: 8,
          font,
          color: rgb(0, 0.3, 0.1),
        });

        // Date
        page.drawText(approvedAt, {
          x: width - 148,
          y: 16,
          size: 7,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      }

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(pdfPath, pdfBytes); // overwrite in-place
      return pdfPath;
    } catch (error: any) {
      throw new Error(`Failed to add approval stamp: ${error?.message}`);
    }
  }

  /**
   * Get PDF page count
   */
  async getPageCount(pdfPath: string): Promise<number> {
    try {
      const existingPdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      return pdfDoc.getPageCount();
    } catch (error) {
      throw new Error(`Failed to read PDF: ${error.message}`);
    }
  }

  /**
   * Extract PDF metadata
   */
  async extractMetadata(pdfPath: string): Promise<any> {
    try {
      const existingPdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      return {
        pageCount: pdfDoc.getPageCount(),
        title: pdfDoc.getTitle(),
        author: pdfDoc.getAuthor(),
        subject: pdfDoc.getSubject(),
        creator: pdfDoc.getCreator(),
        producer: pdfDoc.getProducer(),
        creationDate: pdfDoc.getCreationDate(),
        modificationDate: pdfDoc.getModificationDate(),
      };
    } catch (error) {
      throw new Error(`Failed to extract metadata: ${error.message}`);
    }
  }
}
