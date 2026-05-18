/**
 * Extract invoice data from PDF files using the backend OCR API.
 * The backend runs Tesseract.js on Node.js (server-side) which is reliable.
 * Falls back to basic parsing if backend is unavailable.
 */

import api from '@/services/api'

export interface ExtractedInvoiceData {
  patientName: string
  patientId: string
  providerName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  membershipNumber: string
  diagnosis: string
  diagnosisCode: string
  procedureCode: string
  treatment: string
  serviceDate: string
  insuranceCompany?: string
  accountName?: string
  rawText: string
  confidence: number
  ocrMethod: 'backend-ocr' | 'fallback'
  pageRange: string
  documentPages?: Array<{
    pageNumber: number
    category: string
    categoryLabel: string
    confidence: number
    summary: string
  }>
  lineItems?: Array<{
    description: string
    quantity?: number
    unitPrice?: number
    totalPrice?: number
    taxAmount?: number
    discount?: number
    serviceDate?: string
    procedureCode?: string
    ocrConfidence?: number
    lineNumber?: number
  }>
}

/**
 * Extract invoices from a PDF file by sending it to the backend OCR API.
 */
export async function extractInvoicesFromPdf(
  file: File,
  onProgress?: (msg: string) => void,
  model?: string,
): Promise<{
  invoices: ExtractedInvoiceData[]
  pageCount: number
  modelUsed?: string
}> {
  onProgress?.(`Preparing ${(file.size / 1024 / 1024).toFixed(1)} MB for upload...`)

  try {
    const formData = new FormData()
    formData.append('file', file)
    if (model) formData.append('model', model)

    // Tesseract on a large merged PDF can take 3-5 min; AI models up to 8 min.
    // These timeouts must exceed the Node HTTP server timeout (main.ts: 600 s).
    const timeout = model === 'tesseract' ? 360_000 : 540_000
    const { data } = await api.post('/ocr/extract', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout,
      onUploadProgress: (evt) => {
        if (!evt.total) return
        const pct = Math.round((evt.loaded / evt.total) * 100)
        if (pct < 100) {
          onProgress?.(`Uploading... ${pct}%`)
        } else {
          onProgress?.(model === 'tesseract'
            ? 'OCR scanning pages...'
            : `AI extracting fields${model ? ` (${model})` : ''}...`)
        }
      },
    })

    if (data.success && data.invoices?.length > 0) {
      onProgress?.(`Extracted ${data.invoices.length} invoice(s)`)

      const invoices: ExtractedInvoiceData[] = data.invoices.map((inv: any) => {
        // Clean up provider name (remove trailing noise from OCR)
        let provName = inv.providerName || 'Unknown Provider'
        // Clean OCR noise: remove single chars, symbols before the real name
        provName = provName.replace(/^[^A-Za-z]*/, '') // strip leading non-alpha
        provName = provName.replace(/\b[A-Z]{1,2}\b\s*/g, ' ') // strip isolated 1-2 char fragments
        provName = provName.replace(/\s{2,}/g, ' ').trim()
        // Take only up to first recognized institution suffix
        const provMatch = provName.match(/((?:[A-Z][A-Za-z'.]+\s+){0,5}(?:Hospital|Centre|Center|Clinic|Dental|Medical|Pharmacy|Lab|Foundation|Sikh Hospital)(?:\s+(?:Ltd|Limited|PLC))?)/i)
        if (provMatch) provName = provMatch[1].trim()

        // Clean up insurance company
        let insurance = inv.insuranceCompany || ''
        const insMatch = insurance.match(/^(.+?(?:Insurance|Limited|Ltd|PLC|Group))/i)
        if (insMatch) insurance = insMatch[1].trim()

        // Clean up account name
        let account = inv.accountName || ''
        const accEnd = account.indexOf('-')
        if (accEnd > 5) account = account.substring(0, accEnd).trim()

        return {
          patientName: inv.patientName || 'Unknown Patient',
          patientId: inv.patientId || '',
          providerName: provName,
          invoiceNumber: inv.invoiceNumber || '',
          invoiceDate: inv.invoiceDate || '',
          invoiceAmount: inv.invoiceAmount || 0,
          membershipNumber: inv.membershipNumber || '',
          diagnosis: inv.diagnosis && !inv.diagnosis.includes('ICD Code') ? inv.diagnosis : '',
          diagnosisCode: inv.diagnosisCode || '',
          procedureCode: inv.procedureCode || '',
          treatment: inv.treatment && !inv.treatment.includes('ICD Code') ? inv.treatment : '',
          serviceDate: inv.serviceDate || inv.invoiceDate || '',
          insuranceCompany: insurance,
          accountName: account,
          rawText: inv.rawText || '',
          confidence: inv.confidence || 0.8,
          ocrMethod: 'backend-ocr' as const,
          pageRange: inv.pageRange || '1',
          documentPages: inv.documentPages || [],
          lineItems: Array.isArray(inv.lineItems) ? inv.lineItems : undefined,
        }
      })

      return { invoices, pageCount: data.pageCount || 1, modelUsed: data.modelUsed }
    }

    throw new Error('No data extracted')
  } catch (err: any) {
    console.warn('Backend OCR unavailable, using fallback:', err.message)
    onProgress?.('Backend OCR unavailable, using filename-based fallback')

    // Minimal fallback - just create a placeholder
    return {
      invoices: [{
        patientName: 'OCR Processing Required',
        patientId: '',
        providerName: 'Upload to backend for extraction',
        invoiceNumber: file.name.match(/(CB[\-/][\d\-]+)/i)?.[1] || '',
        invoiceDate: '',
        invoiceAmount: 0,
        membershipNumber: '',
        diagnosis: '',
        diagnosisCode: '',
        procedureCode: '',
        treatment: '',
        serviceDate: new Date().toISOString().split('T')[0],
        rawText: `File: ${file.name} (${(file.size / 1024).toFixed(0)} KB) - Backend OCR required for data extraction`,
        confidence: 0.1,
        ocrMethod: 'fallback',
        pageRange: '1',
      }],
      pageCount: 1,
    }
  }
}
