/**
 * Placeholder provider name used when a staff batch upload doesn't pick a
 * provider. The OCR pipeline reassigns each claim to its real provider once
 * detected from the invoice; reassignment is guarded on this name so a
 * deliberately-chosen provider is never overridden.
 *
 * Kept in a dependency-free module so both `BatchSubmissionService` and
 * `OcrProcessor` can import it without creating a module cycle.
 */
export const AUTO_DETECT_PROVIDER_NAME = 'Auto-Detect (Pending)';
