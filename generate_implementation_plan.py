#!/usr/bin/env python3
"""Generate ClaimsFlow Gap Analysis & Implementation Plan PDF"""

HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ClaimsFlow – Gap Analysis & Implementation Plan</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

  :root {
    --blue:    #1a56db;
    --blue-d:  #1240a8;
    --blue-l:  #ebf5ff;
    --green:   #057a55;
    --green-l: #ecfdf5;
    --amber:   #b45309;
    --amber-l: #fffbeb;
    --red:     #c81e1e;
    --red-l:   #fef2f2;
    --purple:  #7c3aed;
    --purple-l:#f5f3ff;
    --gray:    #1f2937;
    --gray-2:  #374151;
    --gray-3:  #6b7280;
    --gray-4:  #9ca3af;
    --border:  #e5e7eb;
    --bg:      #f9fafb;
    --white:   #ffffff;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    color: var(--gray);
    background: var(--white);
    line-height: 1.6;
  }

  /* ── Cover page ───────────────────────────────── */
  .cover {
    min-height: 100vh;
    background: linear-gradient(145deg, #0f172a 0%, #1e3a5f 50%, #1a56db 100%);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 80px 72px;
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }

  .cover::before {
    content: '';
    position: absolute;
    top: -120px; right: -120px;
    width: 500px; height: 500px;
    border-radius: 50%;
    background: rgba(255,255,255,0.04);
  }

  .cover::after {
    content: '';
    position: absolute;
    bottom: -80px; left: -80px;
    width: 350px; height: 350px;
    border-radius: 50%;
    background: rgba(255,255,255,0.03);
  }

  .cover-badge {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.2);
    color: #93c5fd;
    font-size: 9pt;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 6px 16px;
    border-radius: 20px;
    margin-bottom: 36px;
    display: inline-block;
  }

  .cover h1 {
    font-size: 42pt;
    font-weight: 800;
    color: white;
    line-height: 1.1;
    margin-bottom: 20px;
    letter-spacing: -0.02em;
    max-width: 680px;
  }

  .cover h1 span { color: #60a5fa; }

  .cover .subtitle {
    font-size: 14pt;
    color: #93c5fd;
    font-weight: 400;
    margin-bottom: 60px;
    max-width: 560px;
    line-height: 1.5;
  }

  .cover-meta {
    display: flex;
    gap: 48px;
  }

  .cover-meta-item { color: rgba(255,255,255,0.6); }
  .cover-meta-item strong { display: block; color: white; font-size: 11pt; font-weight: 600; }
  .cover-meta-item span { font-size: 9pt; }

  .cover-divider {
    width: 64px; height: 4px;
    background: linear-gradient(90deg, #60a5fa, #a78bfa);
    border-radius: 2px;
    margin-bottom: 40px;
  }

  /* ── Page layout ──────────────────────────────── */
  .page { padding: 56px 64px; }
  .page-break { page-break-before: always; }

  /* ── Section headers ──────────────────────────── */
  .section-label {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--blue);
    margin-bottom: 8px;
  }

  h2 {
    font-size: 22pt;
    font-weight: 700;
    color: var(--gray);
    margin-bottom: 6px;
    letter-spacing: -0.02em;
  }

  h3 {
    font-size: 13pt;
    font-weight: 600;
    color: var(--gray);
    margin-bottom: 10px;
    margin-top: 28px;
  }

  h4 {
    font-size: 10.5pt;
    font-weight: 600;
    color: var(--gray-2);
    margin-bottom: 6px;
    margin-top: 18px;
  }

  .section-desc {
    color: var(--gray-3);
    font-size: 10pt;
    margin-bottom: 32px;
    max-width: 640px;
    line-height: 1.65;
  }

  .divider { height: 1px; background: var(--border); margin: 32px 0; }

  /* ── Executive summary cards ──────────────────── */
  .exec-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
    margin-bottom: 32px;
  }

  .exec-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }

  .exec-card .label { font-size: 8.5pt; font-weight: 600; color: var(--gray-3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
  .exec-card .value { font-size: 26pt; font-weight: 800; line-height: 1; margin-bottom: 6px; }
  .exec-card .note { font-size: 8.5pt; color: var(--gray-3); }

  .value-blue   { color: var(--blue); }
  .value-green  { color: var(--green); }
  .value-amber  { color: var(--amber); }
  .value-red    { color: var(--red); }
  .value-purple { color: var(--purple); }

  /* ── Callout boxes ────────────────────────────── */
  .callout {
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 20px;
    border-left: 4px solid;
  }

  .callout-blue   { background: var(--blue-l);   border-color: var(--blue);  }
  .callout-green  { background: var(--green-l);  border-color: var(--green); }
  .callout-amber  { background: var(--amber-l);  border-color: var(--amber); }
  .callout-red    { background: var(--red-l);    border-color: var(--red);   }
  .callout-purple { background: var(--purple-l); border-color: var(--purple);}

  .callout-title { font-weight: 700; font-size: 10.5pt; margin-bottom: 5px; }
  .callout-blue   .callout-title { color: var(--blue-d); }
  .callout-green  .callout-title { color: var(--green);  }
  .callout-amber  .callout-title { color: var(--amber);  }
  .callout-red    .callout-title { color: var(--red);    }
  .callout-purple .callout-title { color: var(--purple); }
  .callout p { font-size: 9.5pt; color: var(--gray-2); line-height: 1.6; }

  /* ── Tables ───────────────────────────────────── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 9pt; }
  thead tr { background: var(--gray); color: white; }
  thead th { padding: 10px 14px; text-align: left; font-weight: 600; font-size: 8.5pt; letter-spacing: 0.04em; }
  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:hover { background: var(--bg); }
  tbody td { padding: 9px 14px; vertical-align: top; line-height: 1.5; }
  tbody tr:nth-child(even) { background: #fafafa; }

  /* ── Status badges ────────────────────────────── */
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 8pt;
    font-weight: 600;
    white-space: nowrap;
  }

  .badge-done    { background: #d1fae5; color: #065f46; }
  .badge-partial { background: #fef3c7; color: #92400e; }
  .badge-gap     { background: #fee2e2; color: #991b1b; }
  .badge-planned { background: #ede9fe; color: #5b21b6; }

  .badge-p1 { background: #fee2e2; color: #991b1b; }
  .badge-p2 { background: #fef3c7; color: #92400e; }
  .badge-p3 { background: #d1fae5; color: #065f46; }
  .badge-p4 { background: #ede9fe; color: #5b21b6; }

  .badge-high   { background: #fee2e2; color: #991b1b; }
  .badge-medium { background: #fef3c7; color: #92400e; }
  .badge-low    { background: #d1fae5; color: #065f46; }

  /* ── Phase blocks ─────────────────────────────── */
  .phase {
    border-radius: 12px;
    margin-bottom: 28px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .phase-header {
    padding: 18px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .phase-1 .phase-header { background: linear-gradient(135deg, #1e3a5f, #1a56db); color: white; }
  .phase-2 .phase-header { background: linear-gradient(135deg, #064e3b, #059669); color: white; }
  .phase-3 .phase-header { background: linear-gradient(135deg, #78350f, #d97706); color: white; }
  .phase-4 .phase-header { background: linear-gradient(135deg, #4c1d95, #7c3aed); color: white; }

  .phase-header h3 { color: white; margin: 0; font-size: 13pt; }
  .phase-header .phase-meta { font-size: 9pt; opacity: 0.85; text-align: right; }
  .phase-header .phase-meta strong { display: block; font-size: 11pt; }

  .phase-body { padding: 20px 24px; background: white; }

  .feature-item {
    display: flex;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    align-items: flex-start;
  }

  .feature-item:last-child { border-bottom: none; }

  .feature-icon {
    width: 28px; height: 28px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-size: 14px;
    font-weight: 700;
  }

  .fi-blue   { background: var(--blue-l);   color: var(--blue);  }
  .fi-green  { background: var(--green-l);  color: var(--green); }
  .fi-amber  { background: var(--amber-l);  color: var(--amber); }
  .fi-red    { background: var(--red-l);    color: var(--red);   }
  .fi-purple { background: var(--purple-l); color: var(--purple);}

  .feature-content { flex: 1; }
  .feature-title { font-weight: 600; font-size: 10pt; margin-bottom: 3px; }
  .feature-desc { font-size: 8.5pt; color: var(--gray-3); line-height: 1.5; }
  .feature-tags { margin-top: 5px; display: flex; gap: 6px; flex-wrap: wrap; }

  .tag {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 7.5pt;
    padding: 1px 7px;
    color: var(--gray-3);
    font-weight: 500;
  }

  /* ── Progress bar ─────────────────────────────── */
  .progress-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  .progress-label { width: 200px; font-size: 9pt; font-weight: 500; }
  .progress-bar-wrap { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
  .progress-bar { height: 100%; border-radius: 4px; }
  .pb-blue   { background: var(--blue); }
  .pb-green  { background: var(--green); }
  .pb-amber  { background: var(--amber); }
  .pb-red    { background: var(--red); }
  .progress-pct { width: 40px; text-align: right; font-size: 9pt; font-weight: 600; color: var(--gray-2); }

  /* ── Risk matrix ──────────────────────────────── */
  .risk-row { display: flex; gap: 16px; margin-bottom: 12px; }
  .risk-cell { flex: 1; padding: 14px; border-radius: 8px; border: 1px solid var(--border); }
  .risk-cell .risk-title { font-weight: 600; font-size: 9.5pt; margin-bottom: 4px; }
  .risk-cell .risk-body  { font-size: 8.5pt; color: var(--gray-3); line-height: 1.5; }

  /* ── KPI table ────────────────────────────────── */
  .kpi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 24px;
  }

  .kpi-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
  }

  .kpi-card .kpi-label { font-size: 8pt; font-weight: 600; color: var(--gray-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .kpi-card .kpi-current { font-size: 10pt; color: var(--gray-3); margin-bottom: 4px; }
  .kpi-card .kpi-target { font-size: 10pt; font-weight: 700; color: var(--green); }

  /* ── Footer ───────────────────────────────────── */
  .footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer p { font-size: 8pt; color: var(--gray-4); }

  /* ── Checklist ────────────────────────────────── */
  .checklist { list-style: none; margin: 0; padding: 0; }
  .checklist li {
    padding: 6px 0;
    padding-left: 22px;
    position: relative;
    font-size: 9.5pt;
    color: var(--gray-2);
    line-height: 1.5;
    border-bottom: 1px solid var(--border);
  }
  .checklist li:last-child { border-bottom: none; }
  .checklist li::before {
    content: '✓';
    position: absolute; left: 0;
    color: var(--green);
    font-weight: 700;
    font-size: 9pt;
  }
  .checklist li.gap::before { content: '✗'; color: var(--red); }
  .checklist li.partial::before { content: '~'; color: var(--amber); }

  /* ── Timeline ─────────────────────────────────── */
  .timeline { margin: 16px 0 24px 0; }
  .timeline-item {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
    align-items: flex-start;
  }

  .timeline-dot {
    width: 32px; height: 32px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 11pt;
    flex-shrink: 0;
    color: white;
    margin-top: 2px;
  }

  .td-blue   { background: var(--blue); }
  .td-green  { background: var(--green); }
  .td-amber  { background: var(--amber); }
  .td-purple { background: var(--purple); }

  .timeline-content { flex: 1; }
  .timeline-title { font-weight: 600; font-size: 10.5pt; margin-bottom: 3px; }
  .timeline-period { font-size: 8.5pt; color: var(--gray-3); margin-bottom: 5px; }
  .timeline-items { font-size: 9pt; color: var(--gray-2); line-height: 1.7; }

  p { margin-bottom: 10px; }
  ul { margin: 6px 0 12px 20px; }
  li { font-size: 9.5pt; line-height: 1.6; margin-bottom: 2px; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- COVER PAGE                                                   -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-badge">CIC Insurance Group PLC · Confidential</div>
  <div class="cover-divider"></div>
  <h1>ClaimsFlow<br><span>Gap Analysis &amp;<br>Implementation Plan</span></h1>
  <p class="subtitle">
    A comprehensive business analysis of the current system state, identified
    gaps, and a phased roadmap for closing those gaps to reach full SRD compliance.
  </p>
  <div class="cover-meta">
    <div class="cover-meta-item">
      <strong>Date</strong>
      <span>12 May 2026</span>
    </div>
    <div class="cover-meta-item">
      <strong>Version</strong>
      <span>1.0 — Initial Release</span>
    </div>
    <div class="cover-meta-item">
      <strong>Reference</strong>
      <span>CIC-RFQ-65-25</span>
    </div>
    <div class="cover-meta-item">
      <strong>Classification</strong>
      <span>Internal — Restricted</span>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 1 — EXECUTIVE SUMMARY                               -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="section-label">Section 1</div>
  <h2>Executive Summary</h2>
  <p class="section-desc">
    ClaimsFlow is CIC Insurance Group's medical claims automation platform. This document
    assesses what has been delivered, what functional gaps remain, and prescribes a prioritised
    four-phase implementation roadmap to close those gaps — enabling full automation, compliance,
    and operational efficiency across the claims lifecycle.
  </p>

  <div class="exec-grid">
    <div class="exec-card">
      <div class="label">System Completion</div>
      <div class="value value-amber">68%</div>
      <div class="note">Core foundation is solid; 32% of SRD requirements outstanding</div>
    </div>
    <div class="exec-card">
      <div class="label">Critical Gaps</div>
      <div class="value value-red">7</div>
      <div class="note">Blocking items that affect daily operations or compliance</div>
    </div>
    <div class="exec-card">
      <div class="label">High-Priority Gaps</div>
      <div class="value value-amber">9</div>
      <div class="note">Significant gaps impacting efficiency &amp; reporting</div>
    </div>
    <div class="exec-card">
      <div class="label">Enhancement Gaps</div>
      <div class="value value-blue">8</div>
      <div class="note">Future-value features for scalability &amp; intelligence</div>
    </div>
    <div class="exec-card">
      <div class="label">Recommended Phases</div>
      <div class="value value-purple">4</div>
      <div class="note">Structured over a 6-month delivery horizon</div>
    </div>
    <div class="exec-card">
      <div class="label">Estimated Effort</div>
      <div class="value value-green">~38</div>
      <div class="note">Developer-weeks across backend, frontend &amp; integrations</div>
    </div>
  </div>

  <div class="callout callout-blue">
    <div class="callout-title">Business Context</div>
    <p>
      CIC processes hundreds of medical claims per day across a network of hospitals, clinics, dental
      centres, and pharmacies. The platform automates intake, OCR extraction, fraud detection,
      and multi-level approval. However, the absence of a payment settlement module, SLA enforcement,
      member eligibility verification, and a formal appeals workflow creates operational risk that this
      plan directly addresses.
    </p>
  </div>

  <h3>Current System Strengths</h3>
  <div class="progress-row">
    <span class="progress-label">Authentication &amp; RBAC</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-green" style="width:85%"></div></div>
    <span class="progress-pct">85%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Batch Submission</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-green" style="width:90%"></div></div>
    <span class="progress-pct">90%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">OCR &amp; AI Extraction</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-blue" style="width:80%"></div></div>
    <span class="progress-pct">80%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Fraud Detection</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-blue" style="width:75%"></div></div>
    <span class="progress-pct">75%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Maker-Checker Workflow</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-blue" style="width:70%"></div></div>
    <span class="progress-pct">70%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Provider Onboarding</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-amber" style="width:65%"></div></div>
    <span class="progress-pct">65%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Reporting &amp; Analytics</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-amber" style="width:55%"></div></div>
    <span class="progress-pct">55%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Payment Settlement</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-red" style="width:5%"></div></div>
    <span class="progress-pct">5%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">SLA Management</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-red" style="width:10%"></div></div>
    <span class="progress-pct">10%</span>
  </div>
  <div class="progress-row">
    <span class="progress-label">Member Eligibility</span>
    <div class="progress-bar-wrap"><div class="progress-bar pb-red" style="width:0%"></div></div>
    <span class="progress-pct">0%</span>
  </div>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 2 · Confidential</p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 2 — WHAT IS BUILT (CURRENT STATE)                   -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page page-break">
  <div class="section-label">Section 2</div>
  <h2>Current System State</h2>
  <p class="section-desc">
    A module-by-module inventory of what is live and operational in ClaimsFlow today,
    with completion status and notable caveats.
  </p>

  <table>
    <thead>
      <tr>
        <th style="width:22%">Module</th>
        <th style="width:14%">Status</th>
        <th style="width:50%">What Is Built</th>
        <th style="width:14%">Caveats</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Authentication</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>JWT tokens, bcrypt passwords, account lockout after 5 failures, forced password change on first login, session persistence across cold starts, role-aware redirect on login.</td>
        <td>2FA code exists but is disabled (controller renamed to <code>.disabled</code>)</td>
      </tr>
      <tr>
        <td><strong>RBAC</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Seven roles: Admin, Supervisor, Claims Officer (Maker), Checker, Fraud Officer, Provider Admin, Provider User. Granular permissions table with role-permission mapping. Branch-scoped provider access.</td>
        <td>UI for assigning custom permissions still limited</td>
      </tr>
      <tr>
        <td><strong>Provider Management</strong></td>
        <td><span class="badge badge-partial">Partial</span></td>
        <td>Self-service registration with onboarding documents (incorporation cert, KRA PIN, reference letters). Admin approval workflow. Branch management with region/county. Provider status lifecycle (pending → active).</td>
        <td>No provider performance scorecard; purge workflow limited</td>
      </tr>
      <tr>
        <td><strong>Batch Submission</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Drag-and-drop multi-file upload. Unique batch numbers. PDF watermarking with batch number. Barcode (Code128) stamped per claim. TIFF-to-PDF conversion. Resumable uploads. Queue-based async processing.</td>
        <td>No scan station hardware integration</td>
      </tr>
      <tr>
        <td><strong>Email Ingestion</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Gmail and Outlook OAuth 2.0 polling (every 5 min). Extracts PDF attachments, creates batch submissions automatically. Configurable subject filter. Manual poll trigger in Settings.</td>
        <td>Requires OAuth refresh token setup per mailbox</td>
      </tr>
      <tr>
        <td><strong>OCR Engine</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Multi-AI vision routing: Claude Opus, Gemini 1.5 Pro, Ollama (local), Tesseract fallback. Circuit breaker per provider (5-min cooldown on quota errors). Per-field confidence scoring. Template + zone system for known providers.</td>
        <td>Ollama requires local GPU; accuracy varies by document quality</td>
      </tr>
      <tr>
        <td><strong>Document Classifier</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Gemini-powered document type classification. Zone-based OCR templates with drag-and-drop field placement editor. Unknown document queue with human review and claim linking.</td>
        <td>Template training requires sample documents per provider</td>
      </tr>
      <tr>
        <td><strong>Fraud Detection</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>10 automated fraud signals: round-amount billing, duplicate invoice, missing member identity, high-value threshold, future dates, impossible date sequences, stale claims (&gt;90 days), same-batch member velocity, provider mismatch, low OCR confidence.</td>
        <td>ML-based anomaly scoring not yet implemented</td>
      </tr>
      <tr>
        <td><strong>Maker-Checker Workflow</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Four-stage pipeline: Initial Review → Maker Review → Checker Review → Final Approval. Role-enforced stage access. Separate queues per role. Claim assignment strategies. Rejection with specific reasons and provider notification.</td>
        <td>No SLA timer; no auto-escalation on breach</td>
      </tr>
      <tr>
        <td><strong>Document Management</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>PDF viewer with annotation canvas (highlight, stamp, signature). Document versioning. Merge, split, rotate, reorder pages. Purge request workflow. EDMS integration (graceful degradation when not configured).</td>
        <td>Purge approval UI limited; EDMS sync may lag</td>
      </tr>
      <tr>
        <td><strong>Notifications</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Email (SMTP via Nodemailer) and SMS (Africa's Talking / Twilio) for all key events: batch received, claim approved/rejected, maker/checker assignment, provider status change.</td>
        <td>No real-time WebSocket push; browser notifications absent</td>
      </tr>
      <tr>
        <td><strong>Reports &amp; Analytics</strong></td>
        <td><span class="badge badge-partial">Partial</span></td>
        <td>Claims volume by period, approvals/rejections, fraud signals report, provider performance, processing time, upload summary. Excel/CSV/JSON export. Dashboard charts (area, bar, pie, composed).</td>
        <td>Reports pull from client-side store, not live API. Scheduled reports not wired. No drill-down.</td>
      </tr>
      <tr>
        <td><strong>Audit Logs</strong></td>
        <td><span class="badge badge-done">Live</span></td>
        <td>Comprehensive activity logging: all API actions, user/role/IP captured, old/new values for changes, filterable UI with CSV export.</td>
        <td>Log retention policy not configurable from UI</td>
      </tr>
      <tr>
        <td><strong>eOxegen / EDMS Integration</strong></td>
        <td><span class="badge badge-partial">Partial</span></td>
        <td>Local data saved for both EDMS and eOxegen. Outbound sync wired but in graceful-degradation mode — only activates when API keys are set.</td>
        <td>Live credentials not yet provided; sync untested in production</td>
      </tr>
      <tr>
        <td><strong>Payment Settlement</strong></td>
        <td><span class="badge badge-gap">Not Built</span></td>
        <td>Claim status field includes <em>paid</em> but no payment module exists. Finance receives no structured handoff from the system.</td>
        <td>Critical gap — claims loop completes on paper, not in system</td>
      </tr>
      <tr>
        <td><strong>Member Eligibility</strong></td>
        <td><span class="badge badge-gap">Not Built</span></td>
        <td>Member number and name are captured but never validated against the policy/member database.</td>
        <td>Ghost claims can pass without this check</td>
      </tr>
      <tr>
        <td><strong>Two-Factor Auth</strong></td>
        <td><span class="badge badge-gap">Not Built</span></td>
        <td>TOTP service (speakeasy + QRCode) is written and wired to notifications, but the HTTP controller is disabled. Frontend setup page exists but never succeeds.</td>
        <td>Security gap for privileged accounts</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 3 · Confidential</p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 3 — GAP ANALYSIS                                    -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page page-break">
  <div class="section-label">Section 3</div>
  <h2>Identified Gaps</h2>
  <p class="section-desc">
    All functional, technical, and compliance gaps ranked by impact severity. Each gap
    includes its business impact and the affected stakeholder groups.
  </p>

  <h3>Critical Gaps (P1) — Operational Blockers</h3>
  <p style="font-size:9pt; color:#6b7280; margin-bottom:16px;">
    These gaps prevent the system from completing the full claims lifecycle or expose the business to financial and compliance risk.
  </p>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Gap</th>
        <th>Business Impact</th>
        <th>Affected Roles</th>
        <th>Priority</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>G01</strong></td>
        <td><strong>No Payment Settlement Module</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Approved claims have no structured handoff to Finance. Payment status tracked only as a manual field update with no EFT, bank integration, or payment advice generation.</span></td>
        <td>Finance team cannot reconcile claims. Providers have no payment visibility. SLA on settlement (72hr target) cannot be measured or enforced.</td>
        <td>Finance, Supervisor, Provider</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
      <tr>
        <td><strong>G02</strong></td>
        <td><strong>Two-Factor Authentication Disabled</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The TOTP service is code-complete but the NestJS controller file was renamed to <code>.disabled</code>, making all 2FA endpoints unreachable.</span></td>
        <td>Admin, supervisor, checker, and fraud officer accounts are protected only by password — a single-factor risk. Regulatory frameworks (ISO 27001, CBK guidelines) may require MFA for privileged roles.</td>
        <td>All privileged users</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
      <tr>
        <td><strong>G03</strong></td>
        <td><strong>Password Reset Flow Incomplete</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The Forgot Password frontend page exists, but the backend has no <code>POST /auth/forgot-password</code> or <code>POST /auth/reset-password</code> endpoints. Password reset tokens are never generated or emailed.</span></td>
        <td>Users who forget passwords must contact an admin to reset manually. This is a friction point for provider onboarding and creates an admin bottleneck.</td>
        <td>All users</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
      <tr>
        <td><strong>G04</strong></td>
        <td><strong>No Member Eligibility Verification</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Member numbers and names are captured via OCR but never validated against CIC's member/policy database (Smart or eOxegen). No eligibility API call at claim submission.</span></td>
        <td>Ghost claims (non-member or expired-policy claims) pass fraud detection and enter the workflow. First-line fraud prevention is bypassed, increasing payout risk.</td>
        <td>Claims Officer, Fraud Officer, Supervisor</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
      <tr>
        <td><strong>G05</strong></td>
        <td><strong>No SLA Enforcement or Escalation</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Claims sit in queues indefinitely with no timer, no breach alert, and no auto-escalation. Processing-time data exists in the report module but nothing triggers action on breaches.</span></td>
        <td>Provider SLA agreements (e.g. 48-hour turnaround) are unenforceable in the system. Supervisors have no visibility into aging claims until they manually search.</td>
        <td>Supervisor, Claims Officer, Provider</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
      <tr>
        <td><strong>G06</strong></td>
        <td><strong>Reports Not API-Driven (Client-Side Only)</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">All report charts and tables on the Reports page are built from the in-memory Zustand store (claims loaded in the browser) rather than calling the server-side <code>ReportsService</code> endpoints.</span></td>
        <td>Reports are silently incomplete when the browser store hasn't loaded all records. Large datasets (10,000+ claims) will show wrong figures. Management decisions made on incorrect data.</td>
        <td>Supervisor, Finance, Management</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
      <tr>
        <td><strong>G07</strong></td>
        <td><strong>Scheduled Reports Not Wired</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The <code>Report</code> database model has <code>isScheduled</code>, <code>schedule</code> (cron), and <code>recipients</code> fields, but no scheduler reads these records or triggers report generation.</span></td>
        <td>Management cannot receive automated daily/weekly claims summaries. Finance cannot receive automated settlement reports. Compliance reports must be generated manually.</td>
        <td>Management, Finance, Compliance</td>
        <td><span class="badge badge-p1">Critical</span></td>
      </tr>
    </tbody>
  </table>

  <h3>High-Priority Gaps (P2) — Significant Efficiency &amp; Compliance Impact</h3>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Gap</th>
        <th>Business Impact</th>
        <th>Priority</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>G08</strong></td>
        <td><strong>No Formal Appeal / Dispute Management</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Rejected claims can be resubmitted (resubmissionCount field exists), but there is no structured appeal workflow, appeal reason capture, appeal timeline tracking, or final adjudication record.</span></td>
        <td>Providers have no formal channel to contest rejections. Appeals are handled via phone/email, creating an untracked shadow process and potential liability.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G09</strong></td>
        <td><strong>Real-Time Notifications (WebSocket) Absent</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">All notifications are queue-based emails/SMS. There is no browser push notification or WebSocket event when a claim is assigned, approved, or escalated.</span></td>
        <td>Makers and checkers must manually refresh queues to discover new work. Supervisors miss real-time escalation signals. Average response time increases.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G10</strong></td>
        <td><strong>No Pre-Authorisation Management</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">High-value claims (&gt;KES 200,000) trigger a fraud warning requiring a pre-auth letter, but no pre-authorisation module exists — no pre-auth requests, no tracking, no linkage to the subsequent claim.</span></td>
        <td>Pre-auth letters are manually checked and not linked to the claim in the system. High-value claims can be processed without a verified pre-auth, increasing fraudulent large-claim risk.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G11</strong></td>
        <td><strong>Provider Performance Scorecard Missing</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The system collects sufficient data (approval rates, fraud signals, resubmission rates, processing times per provider) but no scorecard view is surfaced. Provider suspension/blacklisting is manual.</span></td>
        <td>CIC cannot proactively identify high-fraud or non-compliant providers. Contracting decisions are made without data-driven provider quality metrics.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G12</strong></td>
        <td><strong>Duplicate Detection Cross-Provider</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Duplicate invoice detection only checks within the same provider's claims. A member could be billed by two different providers for the same service episode.</span></td>
        <td>Cross-provider duplicate billing is a significant fraud vector for coordinated rings. Current detection misses this entirely.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G13</strong></td>
        <td><strong>No Claims Aging / TAT Dashboard</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Turnaround time data exists in the processing-time report but is not surfaced as an aging dashboard showing claims by days-in-queue, breached SLA, and at-risk items.</span></td>
        <td>Supervisors lack a daily operational view to manage queue backlogs. KPIs for regulator or board reporting cannot be produced without manual extraction.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G14</strong></td>
        <td><strong>Bulk Actions (Approve / Reject / Assign)</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Makers and checkers can only action one claim at a time. No bulk selection, bulk assignment, or bulk rejection with shared reason exists.</span></td>
        <td>During high-volume periods (month-end), individual claim processing creates a bottleneck. A supervisor cannot delegate a batch of 50 claims to a maker in one action.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G15</strong></td>
        <td><strong>Configurable SLA Thresholds in UI</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The <code>SystemConfig</code> table exists for key-value configuration but no admin UI allows setting SLA thresholds (e.g. maker review = 24h, checker review = 48h, payment = 72h). Values are hardcoded.</span></td>
        <td>SLA changes require a code deployment. Different provider contract tiers with different SLAs cannot be supported without engineering involvement.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
      <tr>
        <td><strong>G16</strong></td>
        <td><strong>EDMS / eOxegen Live Integration Untested</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Both integrations run in graceful-degradation mode (no API keys configured). The outbound sync code exists but has not been tested against the actual EDMS and eOxegen endpoints in production.</span></td>
        <td>Documents are not being archived to EDMS. eOxegen does not receive approved claim data for payment linkage. The core system-of-record is incomplete.</td>
        <td><span class="badge badge-p2">High</span></td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 4 · Confidential</p>
  </div>
</div>

<!-- Gap Analysis continued -->
<div class="page page-break">

  <h3>Enhancement Gaps (P3 &amp; P4) — Future Value</h3>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Gap</th>
        <th>Business Value</th>
        <th>Priority</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>G17</strong></td>
        <td><strong>ML-Based Anomaly Scoring</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The <code>anomalyScore</code> field exists on <code>OcrExtraction</code> but is never populated. Rule-based fraud signals exist; a trained ML model would surface subtler patterns.</span></td>
        <td>Reduce false-positive fraud flags by 30–40%; surface patterns invisible to rules (unusual procedure-diagnosis combinations, provider billing velocity shifts).</td>
        <td><span class="badge badge-p3">Medium</span></td>
      </tr>
      <tr>
        <td><strong>G18</strong></td>
        <td><strong>Provider Self-Service Portal (Mobile-Responsive)</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The provider-facing dashboard exists but is not optimised for mobile. Providers at clinic sites often submit from tablets.</span></td>
        <td>Reduces submission errors; increases provider adoption and on-time submission rates. Supports scan-to-submit from clinical environments.</td>
        <td><span class="badge badge-p3">Medium</span></td>
      </tr>
      <tr>
        <td><strong>G19</strong></td>
        <td><strong>Scan Station / Physical Scanner Integration</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Email ingestion is live. The SRD specifies a scan station mode where a physical barcode scanner triggers claim retrieval and document attachment directly in the UI.</span></td>
        <td>Enables CIC branch scanning workflows without email as intermediary. Faster processing of paper-first claims.</td>
        <td><span class="badge badge-p3">Medium</span></td>
      </tr>
      <tr>
        <td><strong>G20</strong></td>
        <td><strong>Adjudication Rules Engine</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">All benefit validation is manual. No rules engine exists to auto-calculate eligible amounts, apply excess/co-pay, or enforce benefit limits per policy.</span></td>
        <td>Would eliminate the majority of manual calculator work by claims officers. Reduces adjudication time from ~15 min to ~3 min per claim.</td>
        <td><span class="badge badge-p3">Medium</span></td>
      </tr>
      <tr>
        <td><strong>G21</strong></td>
        <td><strong>Policy / Benefit Plan Management</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">No policy or benefit plan records exist in the system. The adjudication rules engine (G20) depends on this data being available.</span></td>
        <td>Enables in-system eligibility and benefit cap enforcement, reducing dependence on external Smart system lookups.</td>
        <td><span class="badge badge-p3">Medium</span></td>
      </tr>
      <tr>
        <td><strong>G22</strong></td>
        <td><strong>Advanced Drill-Down Analytics</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Dashboard and Reports show summary-level charts. No drill-down (click provider → see their claims), cohort analysis, or period-over-period comparison exists.</span></td>
        <td>Management can identify trends and anomalies without custom SQL exports. Reduces time-to-insight for board reporting from days to minutes.</td>
        <td><span class="badge badge-p4">Low</span></td>
      </tr>
      <tr>
        <td><strong>G23</strong></td>
        <td><strong>Data Retention &amp; GDPR-Style Purge Automation</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">The <code>PurgeRequest</code> model exists with approval workflow, but there is no automated scheduler to purge claims/documents older than the configured retention period.</span></td>
        <td>Compliance with data protection laws and CIC data governance policy. Reduces storage costs over time.</td>
        <td><span class="badge badge-p4">Low</span></td>
      </tr>
      <tr>
        <td><strong>G24</strong></td>
        <td><strong>Log Retention Configuration UI</strong><br>
          <span style="font-size:8.5pt; color:#6b7280">Activity logs accumulate indefinitely. Retention period is not configurable from the admin UI — requires direct database query or code change.</span></td>
        <td>Prevents unbounded database growth. Meets audit log retention requirements without engineering involvement.</td>
        <td><span class="badge badge-p4">Low</span></td>
      </tr>
    </tbody>
  </table>

  <div class="callout callout-amber">
    <div class="callout-title">Gap Summary by Domain</div>
    <p>
      <strong>Security (G02, G03):</strong> 2FA and password reset are partially built but not functional — quick wins with high impact.<br>
      <strong>Compliance (G01, G06, G07):</strong> Payment tracking, live reporting, and scheduled reports are the most critical gaps for financial governance.<br>
      <strong>Operations (G05, G13, G14):</strong> SLA enforcement, aging dashboard, and bulk actions directly affect daily claims officer productivity.<br>
      <strong>Risk (G04, G12):</strong> Member eligibility and cross-provider duplicate detection are the most significant fraud-control gaps.
    </p>
  </div>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 5 · Confidential</p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 4 — IMPLEMENTATION PLAN                             -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page page-break">
  <div class="section-label">Section 4</div>
  <h2>Implementation Plan</h2>
  <p class="section-desc">
    Four delivery phases over 24 weeks. Each phase is sequenced so that later phases build on
    the foundations established earlier. Critical security and data integrity fixes come first.
  </p>

  <!-- Phase 1 -->
  <div class="phase phase-1">
    <div class="phase-header">
      <div>
        <h3>Phase 1 — Foundations &amp; Security</h3>
        <div style="font-size:9pt; opacity:0.8; margin-top:4px">Weeks 1–4 · Estimated 8 developer-weeks</div>
      </div>
      <div class="phase-meta">
        <strong>4 Items</strong>
        Gaps G02, G03, G06, G16
      </div>
    </div>
    <div class="phase-body">

      <div class="feature-item">
        <div class="feature-icon fi-red">🔐</div>
        <div class="feature-content">
          <div class="feature-title">G02 — Enable Two-Factor Authentication</div>
          <div class="feature-desc">
            Rename <code>two-factor.controller.ts.disabled</code> → <code>two-factor.controller.ts</code> and register it in the AuthModule. Wire the existing TwoFactorService endpoints
            (<code>POST /auth/2fa/generate</code>, <code>POST /auth/2fa/enable</code>, <code>POST /auth/2fa/verify</code>) through the router.
            Update the JWT strategy to check <code>twoFactorEnabled</code> and require a second TOTP step before issuing the final token.
            Make 2FA mandatory for Admin, Supervisor, Checker, and Fraud Officer roles.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 2 days</span>
            <span class="tag">Frontend: 1 day</span>
            <span class="tag">Testing: 1 day</span>
            <span class="tag">Module: auth</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-red">🔑</div>
        <div class="feature-content">
          <div class="feature-title">G03 — Password Reset Flow</div>
          <div class="feature-desc">
            Add a <code>passwordResetToken</code> and <code>passwordResetExpiry</code> field to the User model (migration).
            Implement <code>POST /auth/forgot-password</code>: generate a secure random token, store its hash, email a
            reset link (valid 1 hour) via the existing EmailService. Implement <code>POST /auth/reset-password</code>:
            validate token, enforce password policy (min 8 chars, complexity), clear the token.
            Update the ForgotPassword and a new ResetPassword frontend page to call these endpoints.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">DB migration: 0.5 days</span>
            <span class="tag">Module: auth</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">📊</div>
        <div class="feature-content">
          <div class="feature-title">G06 — Wire Reports Page to Live API</div>
          <div class="feature-desc">
            The <code>ReportsService</code> backend has complete implementations for all report types. Refactor the Reports frontend page
            to call <code>GET /api/reports/claims-volume</code>, <code>/approvals-rejections</code>, <code>/processing-time</code>,
            <code>/provider-performance</code>, and <code>/fraud-summary</code> via API instead of reading the Zustand store.
            Add date-range and filter params. Add loading skeletons and error states. This ensures accuracy for any dataset size.
          </div>
          <div class="feature-tags">
            <span class="tag">Frontend: 4 days</span>
            <span class="tag">Backend: 1 day (minor fixes)</span>
            <span class="tag">Module: reports</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">🔗</div>
        <div class="feature-content">
          <div class="feature-title">G16 — Commission EDMS &amp; eOxegen Live Integration</div>
          <div class="feature-desc">
            Obtain API credentials from the EDMS and eOxegen system owners. Configure <code>EDMS_BASE_URL</code>,
            <code>EDMS_API_KEY</code>, <code>EOXEGEN_BASE_URL</code>, <code>EOXEGEN_API_KEY</code> in the production environment.
            Run end-to-end integration tests against staging endpoints. Add a health-check panel in Settings showing
            last-sync timestamp, sync queue depth, and error count for each integration. Add retry logic with exponential
            backoff for failed syncs.
          </div>
          <div class="feature-tags">
            <span class="tag">DevOps: 2 days</span>
            <span class="tag">Backend: 2 days</span>
            <span class="tag">Testing: 2 days</span>
            <span class="tag">Module: common/integrations</span>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- Phase 2 -->
  <div class="phase phase-2">
    <div class="phase-header">
      <div>
        <h3>Phase 2 — Risk &amp; Operations</h3>
        <div style="font-size:9pt; opacity:0.8; margin-top:4px">Weeks 5–12 · Estimated 14 developer-weeks</div>
      </div>
      <div class="phase-meta">
        <strong>6 Items</strong>
        Gaps G04, G05, G07, G12, G13, G14
      </div>
    </div>
    <div class="phase-body">

      <div class="feature-item">
        <div class="feature-icon fi-red">🛡️</div>
        <div class="feature-content">
          <div class="feature-title">G04 — Member Eligibility Verification</div>
          <div class="feature-desc">
            Create an <code>EligibilityService</code> that calls the eOxegen/Smart member API at claim submission time.
            Check: (a) member exists, (b) policy is active on date of service, (c) benefit type is covered.
            Store eligibility response on the claim (<code>eligibilityStatus</code>, <code>eligibilityCheckedAt</code>, <code>benefitBalance</code>).
            If eligibility check fails, auto-flag the claim as <em>Incomplete</em> and surface a specific reason in the fraud signals panel.
            Allow manual override by a Supervisor with audit trail.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 4 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">DB migration: 1 day</span>
            <span class="tag">Module: claims, workflow</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-amber">⏱️</div>
        <div class="feature-content">
          <div class="feature-title">G05 — SLA Enforcement &amp; Auto-Escalation</div>
          <div class="feature-desc">
            Add a BullMQ scheduled job (<code>sla-checker</code>) that runs every 30 minutes. For each claim in an active workflow stage,
            compare elapsed time against configurable thresholds from <code>SystemConfig</code> (e.g. maker_review = 24h, checker_review = 48h).
            On breach: (1) send email/SMS alert to assignee and their supervisor, (2) set <code>slaBreached = true</code> on the claim,
            (3) escalate to supervisor queue if unactioned after 2x the threshold. Surface SLA status badge (On Track / At Risk / Breached)
            on all claim list views and the workflow dashboard.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 4 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">DB migration: 1 day</span>
            <span class="tag">Module: workflow, notifications</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">📅</div>
        <div class="feature-content">
          <div class="feature-title">G07 — Scheduled Report Delivery</div>
          <div class="feature-desc">
            Wire a NestJS <code>@Cron</code> scheduler that reads all active <code>Report</code> records with <code>isScheduled=true</code>.
            At each scheduled time: execute the corresponding <code>ReportsService</code> method, generate Excel/PDF output using the existing
            export logic, store the result as a <code>ReportExecution</code>, and email to all listed recipients.
            Add a Reports admin UI to create scheduled reports, set cron expressions, and manage recipient lists.
            Add a report run history panel showing last 10 executions with status and download link.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 4 days</span>
            <span class="tag">Frontend: 3 days</span>
            <span class="tag">Module: reports, notifications</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-red">🔍</div>
        <div class="feature-content">
          <div class="feature-title">G12 — Cross-Provider Duplicate Detection</div>
          <div class="feature-desc">
            Extend the <code>computeFraudSignals</code> function to query across all providers when checking for duplicate invoice numbers
            and member + date-of-service + diagnosis combinations.
            Add a <code>cross_provider_duplicate</code> fraud signal type.
            Surface a dedicated Duplicate Claims dashboard under Fraud Queue showing matched pairs with a side-by-side comparison view.
            Allow a Fraud Officer to mark duplicates as confirmed / cleared with investigation notes.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">Module: claims, fraud</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-amber">📈</div>
        <div class="feature-content">
          <div class="feature-title">G13 — Claims Aging &amp; TAT Dashboard</div>
          <div class="feature-desc">
            Add a dedicated Aging Report page (or tab on the Workflow Dashboard) showing:
            claims grouped by days-in-current-stage (0–1d, 1–2d, 2–5d, 5d+),
            breach count by stage and by assigned user, average TAT by provider and claim type,
            a heat-map of bottlenecks by day-of-week.
            All data served from a new <code>GET /api/reports/aging</code> endpoint in <code>ReportsService</code>.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 2 days</span>
            <span class="tag">Frontend: 3 days</span>
            <span class="tag">Module: reports, workflow</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">⚡</div>
        <div class="feature-content">
          <div class="feature-title">G14 — Bulk Actions in Queues</div>
          <div class="feature-desc">
            Add checkbox multi-select to the Maker Queue, Checker Queue, and Claims list views.
            Bulk actions toolbar appears when 1+ claims are selected:
            <em>Assign to me</em>, <em>Assign to user…</em>, <em>Approve selected</em>, <em>Reject selected</em> (with shared reason dialog),
            <em>Export selected</em>.
            Backend: add <code>POST /workflow/bulk-assign</code>, <code>POST /workflow/bulk-approve</code>, <code>POST /workflow/bulk-reject</code>
            endpoints with per-claim audit trail entries. Enforce role restrictions — makers cannot bulk-approve into checker stage.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 3 days</span>
            <span class="tag">Module: workflow, claims</span>
          </div>
        </div>
      </div>

    </div>
  </div>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 6 · Confidential</p>
  </div>
</div>

<!-- Phase 3 & 4 -->
<div class="page page-break">

  <!-- Phase 3 -->
  <div class="phase phase-3">
    <div class="phase-header">
      <div>
        <h3>Phase 3 — Settlement &amp; Provider Experience</h3>
        <div style="font-size:9pt; opacity:0.8; margin-top:4px">Weeks 13–18 · Estimated 10 developer-weeks</div>
      </div>
      <div class="phase-meta">
        <strong>5 Items</strong>
        Gaps G01, G08, G09, G11, G15
      </div>
    </div>
    <div class="phase-body">

      <div class="feature-item">
        <div class="feature-icon fi-green">💳</div>
        <div class="feature-content">
          <div class="feature-title">G01 — Payment Settlement Module</div>
          <div class="feature-desc">
            Build a Finance module with three components:
            <br><strong>(1) Payment Advice Generation:</strong> When a checker approves a claim, auto-generate a structured payment advice record
            (<code>PaymentAdvice</code> model) capturing approved amount, payable-to provider bank details, and a payment reference number.
            <br><strong>(2) Finance Dashboard:</strong> New page for Finance role showing claims approved-but-unpaid, batch payment grouping
            (aggregate multiple claims per provider per period), and export of payment file (EFT/CSV in bank-compatible format).
            <br><strong>(3) Payment Confirmation:</strong> Finance marks batches as <em>paid</em>, system updates all included claims to
            <code>status=paid</code>, sends payment confirmation email to provider with claim-level breakdown.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 5 days</span>
            <span class="tag">Frontend: 4 days</span>
            <span class="tag">DB migration: 1 day</span>
            <span class="tag">New role: Finance</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-amber">⚖️</div>
        <div class="feature-content">
          <div class="feature-title">G08 — Formal Appeal &amp; Dispute Workflow</div>
          <div class="feature-desc">
            Add an <code>Appeal</code> model: linked to a rejected claim, capturing appeal reason, supporting documents uploaded by provider,
            submitted date, and adjudication outcome (upheld / dismissed) with notes.
            Provider portal: shows rejected claims with an <em>Appeal</em> button (available for 30 days post-rejection).
            Supervisor queue: receives appeals, can view original claim + appeal documents side-by-side, records decision.
            Notifications: provider receives appeal acknowledgement (auto), and outcome decision (manual trigger by supervisor).
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 3 days</span>
            <span class="tag">DB migration: 0.5 days</span>
            <span class="tag">Module: claims, workflow</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">🔔</div>
        <div class="feature-content">
          <div class="feature-title">G09 — Real-Time WebSocket Notifications</div>
          <div class="feature-desc">
            Add a NestJS WebSocket gateway (<code>@WebSocketGateway</code> with Socket.IO).
            Emit events on: claim assigned to user, claim approved/rejected, SLA breach, new appeal submitted, batch processing complete.
            Frontend: subscribe on login using the existing auth token. Show in-app notification bell with unread count, notification drawer
            with mark-as-read, and toast pop-ups for urgent events (SLA breach, fraud flag).
            Gracefully falls back to polling if WebSocket unavailable.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">Module: notifications</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-green">🏥</div>
        <div class="feature-content">
          <div class="feature-title">G11 — Provider Performance Scorecard</div>
          <div class="feature-desc">
            Compute a monthly provider scorecard from existing data:
            approval rate, average processing TAT, fraud signal frequency, resubmission rate, incomplete submission rate.
            Surface as a Provider Detail page tab visible to Admin and Supervisor.
            Add a provider ranking table on the Providers list page (sortable by score).
            Automated monthly scorecard email to provider admin.
            Threshold-based automatic suspension recommendation (e.g. fraud rate &gt;15% → flag for review).
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">Module: providers, reports</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">⚙️</div>
        <div class="feature-content">
          <div class="feature-title">G15 — System Configuration Admin UI</div>
          <div class="feature-desc">
            Build a System Config admin page (admin-only) that reads/writes the <code>SystemConfig</code> table.
            Configurable settings: SLA thresholds per workflow stage (hours), high-value claim threshold (KES),
            fraud signal sensitivity toggles, maximum daily submissions per provider,
            log retention period (days), email footer and sender name.
            Changes take effect immediately (the SLA checker job reads config on each run).
            Full audit trail of who changed what configuration and when.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 2 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">Module: admin, workflow</span>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- Phase 4 -->
  <div class="phase phase-4">
    <div class="phase-header">
      <div>
        <h3>Phase 4 — Intelligence &amp; Scale</h3>
        <div style="font-size:9pt; opacity:0.8; margin-top:4px">Weeks 19–24 · Estimated 6 developer-weeks</div>
      </div>
      <div class="phase-meta">
        <strong>7 Items</strong>
        Gaps G10, G17–G24
      </div>
    </div>
    <div class="phase-body">

      <div class="feature-item">
        <div class="feature-icon fi-amber">📋</div>
        <div class="feature-content">
          <div class="feature-title">G10 — Pre-Authorisation Management</div>
          <div class="feature-desc">
            A <code>PreAuthorisation</code> model linked to a provider and member. Provider submits a pre-auth request
            from their portal before the service is rendered. CIC approves/declines with conditions and amount limits.
            Approved pre-auth generates a unique reference number. When a claim is submitted for &gt;KES 200,000,
            the system requires a linked pre-auth reference; claims without one are auto-flagged and held pending pre-auth verification.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 3 days</span>
            <span class="tag">Frontend: 2 days</span>
            <span class="tag">DB migration: 1 day</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-purple">🤖</div>
        <div class="feature-content">
          <div class="feature-title">G17 — ML-Based Anomaly Scoring</div>
          <div class="feature-desc">
            Train an anomaly detection model on historical approved/rejected/fraud claims.
            Features: invoice amount, provider type, diagnosis-procedure pair frequency, member claim velocity,
            day-of-week, batch size. Score each incoming claim 0–1 on anomaly.
            Populate the existing <code>anomalyScore</code> field on <code>OcrExtraction</code>.
            Surface as a "Risk Score" indicator on the claim detail page with contributing factor breakdown.
          </div>
          <div class="feature-tags">
            <span class="tag">Data Science: 5 days</span>
            <span class="tag">Backend: 2 days</span>
            <span class="tag">Frontend: 1 day</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-green">📱</div>
        <div class="feature-content">
          <div class="feature-title">G18 — Mobile-Responsive Provider Portal</div>
          <div class="feature-desc">
            Audit all provider-facing pages (Provider Dashboard, Batch Upload, Claims list, Appeal, Profile) for mobile breakpoints.
            Fix layout issues on screens &lt;768px. Add a Progressive Web App (PWA) manifest so providers can install the
            portal as a home-screen app on Android/iOS tablets. Add camera-capture file upload option for mobile document submission.
          </div>
          <div class="feature-tags">
            <span class="tag">Frontend: 4 days</span>
            <span class="tag">PWA config: 1 day</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-blue">🔬</div>
        <div class="feature-content">
          <div class="feature-title">G20 &amp; G21 — Adjudication Rules Engine &amp; Policy Management</div>
          <div class="feature-desc">
            Import or create a <code>PolicyPlan</code> model with benefit tables (inpatient limit, outpatient limit, dental limit, optical limit,
            co-pay %, excess amounts). Sync from Smart/eOxegen if available, or allow manual management.
            Build a rules engine (<code>AdjudicationService</code>) that, given a member's policy and a claim, computes:
            eligible amount, excess deducted, co-pay deducted, and net payable.
            Surface the adjudication breakdown on the claim detail page for maker review, pre-populated so the officer just confirms or overrides.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 5 days</span>
            <span class="tag">Frontend: 3 days</span>
            <span class="tag">DB migration: 1 day</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-purple">📊</div>
        <div class="feature-content">
          <div class="feature-title">G22 — Advanced Drill-Down Analytics</div>
          <div class="feature-desc">
            Add drill-down navigation: click a bar in the Provider Performance chart → open that provider's claims.
            Click a status segment → filtered claims list. Add period-over-period comparison toggle (e.g. this month vs last month).
            Add cohort analysis: track a batch of claims submitted in a week and show their lifecycle progression over time.
            All powered by the existing <code>ReportsService</code> with additional filter parameters.
          </div>
          <div class="feature-tags">
            <span class="tag">Frontend: 4 days</span>
            <span class="tag">Backend: 1 day</span>
          </div>
        </div>
      </div>

      <div class="feature-item">
        <div class="feature-icon fi-amber">🧹</div>
        <div class="feature-content">
          <div class="feature-title">G23 &amp; G24 — Data Retention &amp; Log Management</div>
          <div class="feature-desc">
            Add a <code>@Cron</code> nightly job that reads <code>SystemConfig</code> for retention periods and:
            (1) auto-creates <code>PurgeRequest</code> records for claims/documents past their retention date (pending human approval),
            (2) deletes <code>ActivityLog</code> records older than the configured retention period (default 2 years).
            Admin UI: log retention configuration field in System Config page (G15). Purge request list with one-click approve/decline.
          </div>
          <div class="feature-tags">
            <span class="tag">Backend: 2 days</span>
            <span class="tag">Frontend: 1 day</span>
          </div>
        </div>
      </div>

    </div>
  </div>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 7 · Confidential</p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 5 — DELIVERY TIMELINE                               -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page page-break">
  <div class="section-label">Section 5</div>
  <h2>Delivery Timeline</h2>
  <p class="section-desc">
    A 24-week horizon from 12 May 2026 across four sequential phases.
    Each phase gate includes a stakeholder review before the next phase begins.
  </p>

  <table>
    <thead>
      <tr>
        <th>Phase</th>
        <th>Weeks</th>
        <th>Dates</th>
        <th>Deliverables</th>
        <th>Effort</th>
        <th>Gate Criteria</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Phase 1</strong><br>Foundations</td>
        <td>1–4</td>
        <td>12 May – 9 Jun 2026</td>
        <td>2FA enabled · Password reset · Live reports API · EDMS/eOxegen commissioned</td>
        <td>8 dev-weeks</td>
        <td>All privileged users can enrol 2FA; reports match DB counts; EDMS sync log shows 0 errors</td>
      </tr>
      <tr>
        <td><strong>Phase 2</strong><br>Risk &amp; Ops</td>
        <td>5–12</td>
        <td>9 Jun – 4 Aug 2026</td>
        <td>Member eligibility check · SLA enforcement · Scheduled reports · Cross-provider duplicates · Aging dashboard · Bulk actions</td>
        <td>14 dev-weeks</td>
        <td>Zero claims proceed without eligibility result; SLA breach notifications firing in staging; bulk approve tested at 100-claim scale</td>
      </tr>
      <tr>
        <td><strong>Phase 3</strong><br>Settlement &amp; UX</td>
        <td>13–18</td>
        <td>4 Aug – 15 Sep 2026</td>
        <td>Payment settlement module · Appeal workflow · WebSocket notifications · Provider scorecard · System config UI</td>
        <td>10 dev-weeks</td>
        <td>Finance can export payment file; providers can submit appeals; in-app notifications appear &lt;2s after event</td>
      </tr>
      <tr>
        <td><strong>Phase 4</strong><br>Intelligence</td>
        <td>19–24</td>
        <td>15 Sep – 27 Oct 2026</td>
        <td>Pre-auth management · ML anomaly scoring · Mobile PWA · Adjudication engine · Drill-down analytics · Data retention</td>
        <td>6 dev-weeks</td>
        <td>ML model AUC &gt;0.80 on test set; pre-auth flow tested with 5 providers; PWA installs on Android/iOS</td>
      </tr>
    </tbody>
  </table>

  <div class="callout callout-green">
    <div class="callout-title">Parallel Quick Wins (can start immediately, &lt;1 week each)</div>
    <p>
      The following items require minimal engineering effort and can be started in parallel with Phase 1 planning:
      <br>• <strong>Enable 2FA controller</strong> (rename file, register module) — 1 day
      <br>• <strong>Fix password reset endpoints</strong> (add 2 routes to auth controller) — 2 days
      <br>• <strong>Wire reports to API</strong> (replace store reads with fetch calls) — 1–2 days per report tab
      <br>These three items alone close 3 of the 7 critical gaps.
    </p>
  </div>

  <h3>Resource Allocation</h3>

  <table>
    <thead>
      <tr>
        <th>Role</th>
        <th>Phase 1</th>
        <th>Phase 2</th>
        <th>Phase 3</th>
        <th>Phase 4</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Backend Engineer</strong></td>
        <td>1×</td>
        <td>2×</td>
        <td>1×</td>
        <td>1×</td>
        <td>NestJS, Prisma, BullMQ</td>
      </tr>
      <tr>
        <td><strong>Frontend Engineer</strong></td>
        <td>1×</td>
        <td>1×</td>
        <td>1×</td>
        <td>1×</td>
        <td>React, Zustand, Recharts</td>
      </tr>
      <tr>
        <td><strong>Data Scientist</strong></td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>1×</td>
        <td>Phase 4 only — anomaly model (G17)</td>
      </tr>
      <tr>
        <td><strong>DevOps / QA</strong></td>
        <td>0.5×</td>
        <td>0.5×</td>
        <td>0.5×</td>
        <td>0.5×</td>
        <td>CI pipeline, integration testing, staging</td>
      </tr>
      <tr>
        <td><strong>BA / Team Lead</strong></td>
        <td>0.5×</td>
        <td>0.5×</td>
        <td>0.5×</td>
        <td>0.5×</td>
        <td>Stakeholder review, acceptance criteria</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 8 · Confidential</p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 6 — SUCCESS METRICS (KPIs)                          -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page page-break">
  <div class="section-label">Section 6</div>
  <h2>Success Metrics &amp; KPIs</h2>
  <p class="section-desc">
    Quantifiable targets for each phase gate and the 12-month post-launch horizon.
    Baselines reflect current observed performance; targets are conservative but meaningful.
  </p>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Claim Processing TAT (Maker → Payment)</div>
      <div class="kpi-current">Current: Unmeasured (manual)</div>
      <div class="kpi-target">Target (Phase 2): &lt;48 hours end-to-end</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">SLA Compliance Rate</div>
      <div class="kpi-current">Current: Unknown (not tracked)</div>
      <div class="kpi-target">Target (Phase 2): &gt;90% claims within SLA</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Fraud Detection Rate</div>
      <div class="kpi-current">Current: Rule-based, 10 signal types</div>
      <div class="kpi-target">Target (Phase 4): +30% with ML scoring (AUC &gt;0.80)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">False Positive Fraud Flags</div>
      <div class="kpi-current">Current: ~25% estimated (round-amount rule overfire)</div>
      <div class="kpi-target">Target (Phase 4): &lt;10% false positive rate</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ghost Claim Rate</div>
      <div class="kpi-current">Current: Unknown (no eligibility check)</div>
      <div class="kpi-target">Target (Phase 2): 0% ineligible claims reach approval</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Provider Onboarding Time</div>
      <div class="kpi-current">Current: 5–10 business days (manual)</div>
      <div class="kpi-target">Target (Phase 3): &lt;3 business days with digital workflow</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Payment Settlement Cycle</div>
      <div class="kpi-current">Current: Unknown (no tracking)</div>
      <div class="kpi-target">Target (Phase 3): &lt;72 hours post-final-approval</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Report Data Accuracy</div>
      <div class="kpi-current">Current: Client-side only — may miss records</div>
      <div class="kpi-target">Target (Phase 1): 100% (server-side API driven)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">System Availability</div>
      <div class="kpi-current">Current: ~97% (no formal SLO)</div>
      <div class="kpi-target">Target: 99.5% uptime (with Redis queue durability)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Provider Portal Adoption</div>
      <div class="kpi-current">Current: Email + portal mix</div>
      <div class="kpi-target">Target (Phase 4): &gt;80% claims via portal (not email)</div>
    </div>
  </div>

  <h3>Risk Register</h3>

  <table>
    <thead>
      <tr>
        <th>Risk</th>
        <th>Likelihood</th>
        <th>Impact</th>
        <th>Mitigation</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>eOxegen API unavailable or undocumented</strong></td>
        <td><span class="badge badge-medium">Medium</span></td>
        <td><span class="badge badge-high">High</span></td>
        <td>Graceful degradation already coded. Request API spec and sandbox from system owner in Phase 1 Week 1. Build mock server for testing.</td>
      </tr>
      <tr>
        <td><strong>Member eligibility API response latency &gt;2s</strong></td>
        <td><span class="badge badge-medium">Medium</span></td>
        <td><span class="badge badge-medium">Medium</span></td>
        <td>Run eligibility check asynchronously after submission. Flag claim as "Eligibility Pending" and update once result arrives (webhook or polling).</td>
      </tr>
      <tr>
        <td><strong>ML model training data insufficient (&lt;10,000 labelled claims)</strong></td>
        <td><span class="badge badge-medium">Medium</span></td>
        <td><span class="badge badge-low">Low</span></td>
        <td>Phase 4 is last; by then 6+ months of data will exist. Start with simple logistic regression as v1; iterate with more complex model.</td>
      </tr>
      <tr>
        <td><strong>Finance team resistance to new payment module</strong></td>
        <td><span class="badge badge-low">Low</span></td>
        <td><span class="badge badge-high">High</span></td>
        <td>Involve Finance lead in Phase 3 design sprint. Ensure EFT file format matches their bank's requirements before build starts.</td>
      </tr>
      <tr>
        <td><strong>Provider 2FA adoption friction</strong></td>
        <td><span class="badge badge-medium">Medium</span></td>
        <td><span class="badge badge-low">Low</span></td>
        <td>Make 2FA optional for Provider roles; mandatory only for CIC internal privileged accounts. Provide step-by-step onboarding guide.</td>
      </tr>
      <tr>
        <td><strong>Scope creep delaying Phase 2</strong></td>
        <td><span class="badge badge-high">High</span></td>
        <td><span class="badge badge-medium">Medium</span></td>
        <td>Lock Phase 2 scope at gate review. Any new requests enter a backlog for Phase 3/4 assessment. BA maintains change log.</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC</p>
    <p>Page 9 · Confidential</p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SECTION 7 — RECOMMENDATIONS & NEXT STEPS                    -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="page page-break">
  <div class="section-label">Section 7</div>
  <h2>Recommendations &amp; Next Steps</h2>
  <p class="section-desc">
    Immediate actions, strategic recommendations, and the decision points required
    before Phase 1 development can commence.
  </p>

  <h3>Immediate Actions (This Week)</h3>

  <ul class="checklist">
    <li>Rename <code>two-factor.controller.ts.disabled</code> to <code>two-factor.controller.ts</code> and register in AuthModule to unblock 2FA — 1 hour effort.</li>
    <li>Implement <code>POST /auth/forgot-password</code> and <code>POST /auth/reset-password</code> endpoints in <code>auth.service.ts</code> — 2 days.</li>
    <li>Refactor the Reports page to call the live <code>/api/reports/*</code> endpoints instead of the Zustand store — 3 days.</li>
    <li>Obtain EDMS API credentials and eOxegen sandbox access from system owners; configure in staging environment.</li>
    <li>Conduct a 1-hour workshop with the Finance team to document their EFT file format requirements for the payment settlement module design.</li>
    <li>Define SLA thresholds per workflow stage in writing (sign-off from Operations Manager) before Phase 2 development begins.</li>
  </ul>

  <h3>Strategic Recommendations</h3>

  <div class="callout callout-blue">
    <div class="callout-title">Recommendation 1: Treat the Reports fix as an emergency hotfix</div>
    <p>
      The current state — where all report numbers are derived from the browser's in-memory store — means that
      every management report generated today is potentially incorrect. This should be classified as a data integrity
      bug and fixed outside of the phased plan, ideally within the current sprint.
    </p>
  </div>

  <div class="callout callout-amber">
    <div class="callout-title">Recommendation 2: Don't delay 2FA or password reset</div>
    <p>
      These two items are essentially done — the code exists. The 2FA fix is a file rename and module registration (1 hour).
      Password reset requires 2 days of backend work. Both should ship in the next deployment. Every week without them is
      a security exposure for privileged accounts.
    </p>
  </div>

  <div class="callout callout-green">
    <div class="callout-title">Recommendation 3: Prioritise Phase 2 member eligibility above all other Phase 2 items</div>
    <p>
      Ghost claims (claims for non-members or lapsed policies) represent the highest direct financial risk.
      Even a lightweight eligibility check — calling eOxegen to confirm the member number exists and the policy is active —
      provides a significant first-line control. This single feature could prevent material fraudulent payouts.
    </p>
  </div>

  <div class="callout callout-purple">
    <div class="callout-title">Recommendation 4: Involve Finance and Compliance in Phase 3 design</div>
    <p>
      The payment settlement module (G01) and data retention (G23/G24) have regulatory implications.
      Finance must sign off on the EFT file format before a line of code is written. Compliance/Legal
      should confirm the retention periods align with the Data Protection Act (Kenya) and CIC's
      own data governance policy.
    </p>
  </div>

  <h3>Decision Points Required from Management</h3>

  <table>
    <thead>
      <tr>
        <th>Decision</th>
        <th>Owner</th>
        <th>Required By</th>
        <th>Blocks</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Confirm SLA thresholds per workflow stage (hours)</td>
        <td>Operations Manager</td>
        <td>Phase 2 start</td>
        <td>G05, G13, G15</td>
      </tr>
      <tr>
        <td>Provide eOxegen/Smart member eligibility API specification</td>
        <td>IT / eOxegen Owner</td>
        <td>Phase 2 Week 1</td>
        <td>G04</td>
      </tr>
      <tr>
        <td>Approve EFT file format and bank details management policy</td>
        <td>Finance Director</td>
        <td>Phase 3 start</td>
        <td>G01</td>
      </tr>
      <tr>
        <td>Confirm data retention periods (claims, documents, logs)</td>
        <td>Legal / Compliance</td>
        <td>Phase 3 start</td>
        <td>G23, G24</td>
      </tr>
      <tr>
        <td>Approve ML model training on historical claims data (GDPR / DPA consent)</td>
        <td>Legal / DPO</td>
        <td>Phase 4 start</td>
        <td>G17</td>
      </tr>
      <tr>
        <td>Confirm provider 2FA mandate scope (all providers or CIC internal only)</td>
        <td>CISO / IT Director</td>
        <td>Phase 1 Week 1</td>
        <td>G02</td>
      </tr>
    </tbody>
  </table>

  <div class="divider"></div>

  <h3>Conclusion</h3>

  <p>
    ClaimsFlow has a strong foundation — the core claim lifecycle, OCR pipeline, fraud detection,
    and maker-checker workflow are operational. The system is not 40% complete as initially assessed;
    active usage and the maturity of the implemented modules place it closer to <strong>68% complete</strong>.
  </p>
  <p>
    However, the gaps that remain are disproportionately important. The absence of a payment module means
    the claims loop never closes in the system. The absence of member eligibility verification means a
    critical fraud gate is open. The reports data accuracy issue means management decisions are being made
    on potentially wrong numbers.
  </p>
  <p>
    The good news: <strong>three of the seven critical gaps can be closed within two weeks</strong> with
    minimal engineering effort. Phase 1 is largely activation work — turning on things already built.
    The real investment is in Phase 2, which delivers the most operational value for the claims processing team.
  </p>
  <p>
    With the right resources and decision-maker engagement on the open questions above, ClaimsFlow can
    reach full SRD compliance by <strong>27 October 2026</strong> — a complete, end-to-end automated
    medical claims platform for CIC Insurance Group.
  </p>

  <div class="footer">
    <p>ClaimsFlow Gap Analysis &amp; Implementation Plan · CIC Insurance Group PLC · 12 May 2026</p>
    <p>Page 10 · Confidential · Prepared by: Business Analysis &amp; Team Lead</p>
  </div>
</div>

</body>
</html>
"""

import subprocess, sys, os

output_path = "/home/bigdev/Desktop/cic/claims/ClaimsFlow_Implementation_Plan.pdf"
html_path   = "/tmp/claimsflow_impl_plan.html"

with open(html_path, "w", encoding="utf-8") as f:
    f.write(HTML_CONTENT)

print(f"HTML written to {html_path}")
print("Converting to PDF with WeasyPrint …")

result = subprocess.run(
    ["python3", "-m", "weasyprint", html_path, output_path],
    capture_output=True, text=True
)

if result.returncode != 0:
    print("WeasyPrint stderr:", result.stderr[:2000])
    sys.exit(1)

size_kb = os.path.getsize(output_path) // 1024
print(f"PDF written to: {output_path} ({size_kb} KB)")
