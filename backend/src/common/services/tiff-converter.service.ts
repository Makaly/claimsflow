import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TiffConverterService {
  /**
   * Convert TIFF to PDF with quality preservation
   */
  async convertTiffToPdf(
    tiffPath: string,
    outputPath?: string,
  ): Promise<string> {
    try {
      // Create a new PDF document
      const pdfDoc = await PDFDocument.create();

      // Read TIFF file
      const tiffBuffer = fs.readFileSync(tiffPath);

      // Check if multi-page TIFF
      const metadata = await sharp(tiffBuffer).metadata();
      const pageCount = metadata.pages || 1;

      // Convert each page
      for (let i = 0; i < pageCount; i++) {
        // Extract page as PNG
        const pngBuffer = await sharp(tiffBuffer, { page: i })
          .png({
            quality: 100,
            compressionLevel: 9,
          })
          .toBuffer();

        // Embed PNG in PDF
        const image = await pdfDoc.embedPng(pngBuffer);
        const page = pdfDoc.addPage([image.width, image.height]);

        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        });
      }

      // Save PDF
      const pdfBytes = await pdfDoc.save();
      const finalOutputPath = outputPath || tiffPath.replace(/\.tiff?$/i, '.pdf');
      fs.writeFileSync(finalOutputPath, pdfBytes);

      return finalOutputPath;
    } catch (error) {
      throw new Error(`Failed to convert TIFF to PDF: ${error.message}`);
    }
  }

  /**
   * Batch convert multiple TIFF files to PDFs
   */
  async batchConvertTiffToPdf(
    tiffPaths: string[],
    outputDir: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ successful: string[]; failed: Array<{ path: string; error: string }> }> {
    const successful: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (let i = 0; i < tiffPaths.length; i++) {
      const tiffPath = tiffPaths[i];
      try {
        const fileName = path.basename(tiffPath, path.extname(tiffPath));
        const outputPath = path.join(outputDir, `${fileName}.pdf`);

        const result = await this.convertTiffToPdf(tiffPath, outputPath);
        successful.push(result);

        if (onProgress) {
          onProgress(i + 1, tiffPaths.length);
        }
      } catch (error) {
        failed.push({
          path: tiffPath,
          error: error.message,
        });
      }
    }

    return { successful, failed };
  }

  /**
   * Convert TIFF with metadata preservation
   */
  async convertWithMetadata(
    tiffPath: string,
    metadata: {
      title?: string;
      author?: string;
      subject?: string;
      keywords?: string[];
    },
    outputPath?: string,
  ): Promise<string> {
    try {
      const pdfPath = await this.convertTiffToPdf(tiffPath, outputPath);

      // Read the PDF and add metadata
      const pdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      if (metadata.title) pdfDoc.setTitle(metadata.title);
      if (metadata.author) pdfDoc.setAuthor(metadata.author);
      if (metadata.subject) pdfDoc.setSubject(metadata.subject);
      if (metadata.keywords) pdfDoc.setKeywords(metadata.keywords);

      pdfDoc.setProducer('CIC Claims Automation');
      pdfDoc.setCreationDate(new Date());

      // Save with metadata
      const updatedPdfBytes = await pdfDoc.save();
      fs.writeFileSync(pdfPath, updatedPdfBytes);

      return pdfPath;
    } catch (error) {
      throw new Error(`Failed to convert with metadata: ${error.message}`);
    }
  }

  /**
   * Get TIFF information
   */
  async getTiffInfo(tiffPath: string): Promise<{
    width: number;
    height: number;
    format: string;
    pages: number;
    size: number;
  }> {
    try {
      const buffer = fs.readFileSync(tiffPath);
      const metadata = await sharp(buffer).metadata();
      const stats = fs.statSync(tiffPath);

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        pages: metadata.pages || 1,
        size: stats.size,
      };
    } catch (error) {
      throw new Error(`Failed to get TIFF info: ${error.message}`);
    }
  }

  /**
   * Validate TIFF file
   */
  async validateTiff(tiffPath: string): Promise<boolean> {
    try {
      const buffer = fs.readFileSync(tiffPath);
      const metadata = await sharp(buffer).metadata();
      return metadata.format === 'tiff';
    } catch (error) {
      return false;
    }
  }
}
