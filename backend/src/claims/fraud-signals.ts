/**
 * Fraud signal detection — runs at claim creation / OCR completion time.
 * Results are stored on the Claim.fraudSignals JSON field so they reflect
 * what the system detected at the moment of processing, not at view time.
 */

export interface FraudSignal {
  level: 'critical' | 'warning'
  title: string
  detail: string
  detectedAt: string
  // Structured metadata for enriched display
  meta?: {
    duplicateClaimNumbers?: string[]   // CLM-XXXX refs for duplicate signals
    uploadedBy?: string                // who submitted the duplicate claim
    uploadedAt?: string
  }
}

interface ClaimInput {
  id?: string
  invoiceAmount?: number | null
  invoiceNumber?: string | null
  memberNumber?: string | null
  memberName?: string | null
  invoiceDate?: Date | string | null
  dateOfService?: Date | string | null
  ocrConfidence?: number | null
  aiExtracted?: boolean
}

interface BatchSibling {
  memberNumber?: string | null;
  invoiceAmount?: number | null;
}

export interface DuplicateClaimRef {
  claimNumber: string
  uploadedBy?: string | null
  submittedAt?: string | null
}

/**
 * Compute fraud signals for a single claim.
 * `allInvoiceNumbers` is a Set of invoice numbers from other claims for this provider.
 * `batchSiblings` is the list of other claims already saved under the same batch number.
 */
export function computeFraudSignals(
  claim: ClaimInput,
  allInvoiceNumbers: Set<string> = new Set(),
  batchSiblings: BatchSibling[] = [],
  duplicateClaimRefs: DuplicateClaimRef[] = [],
): FraudSignal[] {
  const signals: FraudSignal[] = []
  const now = new Date().toISOString()
  const amt = claim.invoiceAmount || 0

  // 1. Round-amount billing
  if (amt >= 10000 && amt % 1000 === 0) {
    signals.push({
      level: amt >= 100000 ? 'critical' : 'warning',
      title: 'Round-Amount Billing',
      detail: `Invoice amount is exactly KES ${amt.toLocaleString()} — a perfect round number. Genuine itemised medical bills produce irregular totals because they aggregate line items at individual pricing. This pattern is statistically associated with inflated or estimated invoices.`,
      detectedAt: now,
    })
  }

  // 2. Unknown / missing patient identity
  const missingMemberNum = !claim.memberNumber || claim.memberNumber.trim() === ''
  const unknownName = !claim.memberName || claim.memberName.toLowerCase().includes('unknown') || claim.memberName.trim() === ''
  if (missingMemberNum || unknownName) {
    signals.push({
      level: 'critical',
      title: 'Unknown / Missing Patient Identity',
      detail: `Member number is ${missingMemberNum ? 'absent' : `"${claim.memberNumber}"`} and patient name is "${claim.memberName || 'blank'}". Without verified member identity this claim cannot be cross-checked against policy eligibility, benefit limits, or prior claim history — a primary indicator of a ghost claim.`,
      detectedAt: now,
    })
  }

  // 3. High-value claim
  if (amt > 200000) {
    signals.push({
      level: 'warning',
      title: 'High-Value Claim',
      detail: `Invoice amount KES ${amt.toLocaleString()} exceeds the KES 200,000 threshold. Requires mandatory claims officer approval and a matching pre-authorisation letter before processing.`,
      detectedAt: now,
    })
  }

  // 4. Duplicate invoice number
  if (claim.invoiceNumber && allInvoiceNumbers.has(claim.invoiceNumber.trim())) {
    const refs = duplicateClaimRefs.filter(r => r.claimNumber)
    const refList = refs.map(r => r.claimNumber).join(', ') || 'another claim'
    signals.push({
      level: 'critical',
      title: 'Duplicate Invoice Number',
      detail: `Invoice number "${claim.invoiceNumber}" already appears on ${refs.length || 1} other claim(s): ${refList}. A provider invoice number is a unique identifier — the same number cannot legitimately appear on two separate claims. This is a double-billing attempt: submitting the same invoice twice hoping one payment slips through.`,
      detectedAt: now,
      meta: {
        duplicateClaimNumbers: refs.map(r => r.claimNumber),
        uploadedBy: refs[0]?.uploadedBy ?? undefined,
        uploadedAt: refs[0]?.submittedAt ?? undefined,
      },
    })
  }

  // 5. Low OCR confidence
  if (claim.aiExtracted && claim.ocrConfidence != null && claim.ocrConfidence < 0.70) {
    signals.push({
      level: 'warning',
      title: 'Low OCR Confidence',
      detail: `AI extracted claim fields with only ${(claim.ocrConfidence * 100).toFixed(0)}% confidence. Critical values (amount, member number, invoice number) may have been misread. Manual field-by-field verification is required before this claim can proceed to maker review.`,
      detectedAt: now,
    })
  }

  // 6. Impossible date sequence
  if (claim.dateOfService && claim.invoiceDate) {
    const svcDate = new Date(claim.dateOfService)
    const invDate = new Date(claim.invoiceDate)
    if (svcDate > invDate) {
      // Guard against OCR fallback pollution: if the service date is today (or
      // yesterday) but the invoice is historical, the date is almost certainly
      // a default value injected when extraction found no service date — not
      // evidence of backdating. Require at least a 2-day gap from today to fire.
      const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
      const svcDateIsExtractionDefault = svcDate >= twoDaysAgo
      if (!svcDateIsExtractionDefault) {
        signals.push({
          level: 'critical',
          title: 'Impossible Date Sequence',
          detail: `Service date (${svcDate.toDateString()}) is after invoice date (${invDate.toDateString()}). A provider cannot issue an invoice for a service that has not yet been performed — this indicates backdating or deliberate date manipulation.`,
          detectedAt: now,
        })
      }
    }
  }

  // 7. Future-dated invoice
  const today = new Date(); today.setHours(23, 59, 59, 999)
  if (claim.invoiceDate) {
    const invDate = new Date(claim.invoiceDate)
    if (!isNaN(invDate.getTime()) && invDate > today) {
      signals.push({
        level: 'critical',
        title: 'Future-Dated Invoice',
        detail: `Invoice date (${invDate.toDateString()}) is in the future. Providers cannot legitimately issue invoices for services that have not yet occurred. This is a strong indicator of pre-dated or fabricated documentation.`,
        detectedAt: now,
      })
    }
  }

  // 8. Future service date — only if clearly future (> 2 days out), to avoid
  //    false positives when OCR defaults service date to today's date.
  if (claim.dateOfService) {
    const svcDate = new Date(claim.dateOfService)
    const twoDaysFromNow = new Date(); twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
    if (!isNaN(svcDate.getTime()) && svcDate > twoDaysFromNow) {
      signals.push({
        level: 'critical',
        title: 'Future Service Date',
        detail: `Date of service (${svcDate.toDateString()}) is in the future. Claims can only be submitted after a service has been rendered.`,
        detectedAt: now,
      })
    }
  }

  // 9. Stale claim — service date more than 90 days ago
  if (claim.dateOfService) {
    const svcDate = new Date(claim.dateOfService)
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    if (!isNaN(svcDate.getTime()) && svcDate < ninetyDaysAgo) {
      signals.push({
        level: 'warning',
        title: 'Stale Claim — Service Over 90 Days Old',
        detail: `Service date (${svcDate.toDateString()}) is more than 90 days ago. Late submissions increase the risk of fabricated or duplicate claims. Verify original supporting documentation before approval.`,
        detectedAt: now,
      })
    }
  }

  // 10. Same-batch member velocity — same member appearing in multiple claims in this batch
  if (claim.memberNumber && batchSiblings.length > 0) {
    const sameMemCount = batchSiblings.filter(
      s => s.memberNumber && s.memberNumber.trim() === claim.memberNumber!.trim()
    ).length
    if (sameMemCount >= 1) {
      signals.push({
        level: 'warning',
        title: 'Member Appears Multiple Times in Batch',
        detail: `Member number "${claim.memberNumber}" already has ${sameMemCount} other claim(s) in this batch. Multiple claims for the same member in a single submission may indicate duplicate billing, benefit limit gaming, or splitting of a single episode of care.`,
        detectedAt: now,
      })
    }

    // Escalate to critical if same member AND same amount
    const sameMemSameAmt = batchSiblings.filter(
      s =>
        s.memberNumber?.trim() === claim.memberNumber!.trim() &&
        s.invoiceAmount != null &&
        s.invoiceAmount === claim.invoiceAmount
    ).length
    if (sameMemSameAmt >= 1) {
      signals.push({
        level: 'critical',
        title: 'Duplicate Member + Amount in Same Batch',
        detail: `Member "${claim.memberNumber}" has another claim for the exact same amount (KES ${amt.toLocaleString()}) in this batch. Identical member and amount combinations are a strong indicator of duplicate invoice submission.`,
        detectedAt: now,
      })
    }
  }

  return signals
}

/**
 * Inject a provider-mismatch fraud signal when the uploading user's provider
 * does not match the provider extracted from the invoice.
 */
export function providerMismatchSignal(
  uploaderProviderName: string,
  invoiceProviderName: string,
): FraudSignal {
  return {
    level: 'critical',
    title: 'Provider Mismatch — Possible Fraud',
    detail: `This invoice was uploaded by a user belonging to "${uploaderProviderName}" but the invoice identifies the provider as "${invoiceProviderName}". Submitting claims on behalf of a different provider is a critical fraud indicator. The batch and all affected invoices have been flagged for review.`,
    detectedAt: new Date().toISOString(),
  }
}
