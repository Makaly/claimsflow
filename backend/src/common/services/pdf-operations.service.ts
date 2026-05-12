import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';

@Injectable()
export class PdfOperationsService {
  /**
   * Merge multiple PDF files into one
   */
  async mergePdfs(pdfPaths: string[], outputPath: string): Promise<string> {
    try {
      const mergedPdf = await PDFDocument.create();

      for (const pdfPath of pdfPaths) {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
      }

      const mergedPdfBytes = await mergedPdf.save();
      fs.writeFileSync(outputPath, mergedPdfBytes);

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to merge PDFs: ${error.message}`);
    }
  }

  /**
   * Split PDF into separate files by page ranges
   */
  async splitPdf(
    pdfPath: string,
    pageRanges: Array<{ start: number; end: number; outputPath: string }>,
  ): Promise<string[]> {
    try {
      const pdfBytes = fs.readFileSync(pdfPath);
      const sourcePdf = await PDFDocument.load(pdfBytes);
      const outputPaths: string[] = [];

      for (const range of pageRanges) {
        const newPdf = await PDFDocument.create();

        // Copy pages in the range (0-indexed)
        const pagesToCopy = [];
        for (let i = range.start - 1; i < range.end; i++) {
          pagesToCopy.push(i);
        }

        const copiedPages = await newPdf.copyPages(sourcePdf, pagesToCopy);
        copiedPages.forEach((page) => {
          newPdf.addPage(page);
        });

        const newPdfBytes = await newPdf.save();
        fs.writeFileSync(range.outputPath, newPdfBytes);
        outputPaths.push(range.outputPath);
      }

      return outputPaths;
    } catch (error) {
      throw new Error(`Failed to split PDF: ${error.message}`);
    }
  }

  /**
   * Extract specific pages from PDF
   */
  async extractPages(
    pdfPath: string,
    pageNumbers: number[],
    outputPath: string,
  ): Promise<string> {
    try {
      const pdfBytes = fs.readFileSync(pdfPath);
      const sourcePdf = await PDFDocument.load(pdfBytes);
      const newPdf = await PDFDocument.create();

      // Convert to 0-indexed
      const pageIndices = pageNumbers.map((n) => n - 1);
      const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);

      copiedPages.forEach((page) => {
        newPdf.addPage(page);
      });

      const newPdfBytes = await newPdf.save();
      fs.writeFileSync(outputPath, newPdfBytes);

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to extract pages: ${error.message}`);
    }
  }

  /**
   * Remove specific pages from PDF
   */
  async removePages(
    pdfPath: string,
    pageNumbersToRemove: number[],
    outputPath: string,
  ): Promise<string> {
    try {
      const pdfBytes = fs.readFileSync(pdfPath);
      const pdf = await PDFDocument.load(pdfBytes);

      const totalPages = pdf.getPageCount();
      const pagesToKeep = [];

      for (let i = 1; i <= totalPages; i++) {
        if (!pageNumbersToRemove.includes(i)) {
          pagesToKeep.push(i - 1); // 0-indexed
        }
      }

      const newPdf = await PDFDocument.create();
      const copiedPages = await newPdf.copyPages(pdf, pagesToKeep);

      copiedPages.forEach((page) => {
        newPdf.addPage(page);
      });

      const newPdfBytes = await newPdf.save();
      fs.writeFileSync(outputPath, newPdfBytes);

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to remove pages: ${error.message}`);
    }
  }

  /**
   * Rotate PDF pages
   */
  async rotatePages(
    pdfPath: string,
    rotation: 90 | 180 | 270,
    pageNumbers?: number[], // If not provided, rotate all pages
    outputPath?: string,
  ): Promise<string> {
    try {
      const pdfBytes = fs.readFileSync(pdfPath);
      const pdf = await PDFDocument.load(pdfBytes);
      const pages = pdf.getPages();

      const pagesToRotate = pageNumbers
        ? pageNumbers.map((n) => n - 1)
        : pages.map((_, i) => i);

      pagesToRotate.forEach((pageIndex) => {
        const page = pages[pageIndex];
        page.setRotation({ angle: rotation, type: 'degrees' as any });
      });

      const rotatedPdfBytes = await pdf.save();
      const finalOutputPath = outputPath || pdfPath.replace('.pdf', '_rotated.pdf');
      fs.writeFileSync(finalOutputPath, rotatedPdfBytes);

      return finalOutputPath;
    } catch (error) {
      throw new Error(`Failed to rotate pages: ${error.message}`);
    }
  }

  /**
   * Reorder PDF pages
   */
  async reorderPages(
    pdfPath: string,
    newOrder: number[], // Array of page numbers in desired order
    outputPath: string,
  ): Promise<string> {
    try {
      const pdfBytes = fs.readFileSync(pdfPath);
      const sourcePdf = await PDFDocument.load(pdfBytes);
      const newPdf = await PDFDocument.create();

      // Convert to 0-indexed
      const pageIndices = newOrder.map((n) => n - 1);
      const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);

      copiedPages.forEach((page) => {
        newPdf.addPage(page);
      });

      const newPdfBytes = await newPdf.save();
      fs.writeFileSync(outputPath, newPdfBytes);

      return outputPath;
    } catch (error) {
      throw new Error(`Failed to reorder pages: ${error.message}`);
    }
  }
}
