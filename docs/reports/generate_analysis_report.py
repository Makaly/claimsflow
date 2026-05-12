#!/usr/bin/env python3
"""Generate ClaimsFlow system analysis report as a PDF."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, PageBreak
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame
from reportlab.lib import colors
import datetime

# ── Colour palette ──────────────────────────────────────────────────
CIC_NAVY   = HexColor("#0A2342")
CIC_GOLD   = HexColor("#C8922A")
CIC_TEAL   = HexColor("#1B6CA8")
CIC_LIGHT  = HexColor("#EDF2F8")
CIC_RED    = HexColor("#C0392B")
CIC_GREEN  = HexColor("#1E8449")
CIC_ORANGE = HexColor("#E67E22")
GREY_MID   = HexColor("#7F8C8D")
GREY_LIGHT = HexColor("#F4F6F7")

OUTPUT = "/home/bigdev/Desktop/cic/claims/ClaimsFlow_System_Analysis.pdf"

# ── Page layout ──────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4
MARGIN = 2 * cm

# ── Style factory ────────────────────────────────────────────────────
base_styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, **kw)

STYLES = {
    # Cover
    "cover_title": S("cover_title", fontName="Helvetica-Bold",
                     fontSize=28, textColor=white, leading=34, alignment=TA_CENTER),
    "cover_sub":   S("cover_sub",   fontName="Helvetica",
                     fontSize=14, textColor=CIC_GOLD,   leading=20, alignment=TA_CENTER),
    "cover_meta":  S("cover_meta",  fontName="Helvetica",
                     fontSize=10, textColor=white,       leading=14, alignment=TA_CENTER),

    # Body
    "h1": S("h1", fontName="Helvetica-Bold", fontSize=16,
            textColor=CIC_NAVY, leading=20, spaceBefore=14, spaceAfter=4),
    "h2": S("h2", fontName="Helvetica-Bold", fontSize=13,
            textColor=CIC_TEAL, leading=17, spaceBefore=10, spaceAfter=3),
    "h3": S("h3", fontName="Helvetica-Bold", fontSize=11,
            textColor=CIC_NAVY, leading=15, spaceBefore=8,  spaceAfter=2),
    "body": S("body", fontName="Helvetica", fontSize=10,
              textColor=black, leading=15, spaceAfter=4, alignment=TA_JUSTIFY),
    "body_bold": S("body_bold", fontName="Helvetica-Bold", fontSize=10,
                   textColor=black, leading=15, spaceAfter=4),
    "bullet": S("bullet", fontName="Helvetica", fontSize=10,
                textColor=black, leading=14, leftIndent=14,
                spaceAfter=3, bulletIndent=4),
    "bullet2": S("bullet2", fontName="Helvetica", fontSize=9.5,
                 textColor=GREY_MID, leading=13, leftIndent=28,
                 spaceAfter=2, bulletIndent=18),
    "caption": S("caption", fontName="Helvetica-Oblique", fontSize=8.5,
                 textColor=GREY_MID, leading=12, alignment=TA_CENTER),
    "table_hdr": S("table_hdr", fontName="Helvetica-Bold", fontSize=9,
                   textColor=white, leading=12, alignment=TA_CENTER),
    "table_cell": S("table_cell", fontName="Helvetica", fontSize=9,
                    textColor=black, leading=12),
    "table_cell_c": S("table_cell_c", fontName="Helvetica", fontSize=9,
                      textColor=black, leading=12, alignment=TA_CENTER),
    "pill_green": S("pill_green", fontName="Helvetica-Bold", fontSize=9,
                    textColor=CIC_GREEN, leading=12),
    "pill_red":   S("pill_red",   fontName="Helvetica-Bold", fontSize=9,
                    textColor=CIC_RED,   leading=12),
    "pill_orange":S("pill_orange",fontName="Helvetica-Bold", fontSize=9,
                    textColor=CIC_ORANGE,leading=12),
    "footer": S("footer", fontName="Helvetica-Oblique", fontSize=7.5,
                textColor=GREY_MID, leading=10, alignment=TA_CENTER),
}

# ── Helper builders ──────────────────────────────────────────────────

def hr(color=CIC_GOLD, width=1.2):
    return HRFlowable(width="100%", thickness=width, color=color, spaceAfter=6, spaceBefore=4)

def sp(h=6):
    return Spacer(1, h)

def p(text, style="body"):
    return Paragraph(text, STYLES[style])

def h1(text): return p(text, "h1")
def h2(text): return p(text, "h2")
def h3(text): return p(text, "h3")

def bullet(text, level=1):
    key = "bullet" if level == 1 else "bullet2"
    marker = "•" if level == 1 else "–"
    return Paragraph(f"{marker}&nbsp;&nbsp;{text}", STYLES[key])

def coloured_bar(label, color=CIC_NAVY):
    data = [[Paragraph(label, ParagraphStyle("barlabel", fontName="Helvetica-Bold",
                        fontSize=11, textColor=white, leading=14))]]
    t = Table(data, colWidths=[PAGE_W - 2*MARGIN])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0),(-1,-1), color),
        ("TOPPADDING",    (0,0),(-1,-1), 6),
        ("BOTTOMPADDING", (0,0),(-1,-1), 6),
        ("LEFTPADDING",   (0,0),(-1,-1), 10),
    ]))
    return t

def info_box(text, color=CIC_LIGHT, border=CIC_TEAL):
    data = [[Paragraph(text, STYLES["body"])]]
    t = Table(data, colWidths=[PAGE_W - 2*MARGIN])
    t.setStyle(TableStyle([
        ("BACKGROUND",   (0,0),(-1,-1), color),
        ("BOX",          (0,0),(-1,-1), 1.5, border),
        ("LEFTPADDING",  (0,0),(-1,-1), 10),
        ("RIGHTPADDING", (0,0),(-1,-1), 10),
        ("TOPPADDING",   (0,0),(-1,-1), 8),
        ("BOTTOMPADDING",(0,0),(-1,-1), 8),
    ]))
    return t

def two_col_table(rows, col_widths=None, header=None, header_color=CIC_NAVY):
    if col_widths is None:
        col_widths = [(PAGE_W - 2*MARGIN)*0.38, (PAGE_W - 2*MARGIN)*0.62]
    style_list = [
        ("GRID",         (0,0),(-1,-1), 0.4, HexColor("#CCCCCC")),
        ("TOPPADDING",   (0,0),(-1,-1), 5),
        ("BOTTOMPADDING",(0,0),(-1,-1), 5),
        ("LEFTPADDING",  (0,0),(-1,-1), 8),
        ("RIGHTPADDING", (0,0),(-1,-1), 8),
        ("ROWBACKGROUNDS",(0,0),(-1,-1), [white, GREY_LIGHT]),
        ("VALIGN",       (0,0),(-1,-1), "TOP"),
    ]
    table_data = []
    if header:
        hdr_cells = [Paragraph(h, STYLES["table_hdr"]) for h in header]
        table_data.append(hdr_cells)
        style_list += [
            ("BACKGROUND", (0,0),(-1,0), header_color),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [white, GREY_LIGHT]),
        ]
    for r in rows:
        table_data.append([Paragraph(str(c), STYLES["table_cell"]) for c in r])
    t = Table(table_data, colWidths=col_widths)
    t.setStyle(TableStyle(style_list))
    return t

def priority_table(items):
    """items: list of (priority, area, description, effort, impact)"""
    header = ["#", "Area", "Improvement", "Effort", "Impact"]
    col_w = [0.5*cm, 3.2*cm, 9.2*cm, 2*cm, 2*cm]
    style_list = [
        ("GRID",         (0,0),(-1,-1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND",   (0,0),(-1,0),  CIC_NAVY),
        ("TOPPADDING",   (0,0),(-1,-1), 5),
        ("BOTTOMPADDING",(0,0),(-1,-1), 5),
        ("LEFTPADDING",  (0,0),(-1,-1), 6),
        ("RIGHTPADDING", (0,0),(-1,-1), 6),
        ("VALIGN",       (0,0),(-1,-1), "TOP"),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [white, GREY_LIGHT]),
    ]
    rows = [[Paragraph(h, STYLES["table_hdr"]) for h in header]]
    for i, (n, area, desc, effort, impact) in enumerate(items, 1):
        impact_color = CIC_GREEN if impact == "High" else (CIC_ORANGE if impact == "Medium" else GREY_MID)
        effort_color = CIC_RED if effort == "High" else (CIC_ORANGE if effort == "Medium" else CIC_GREEN)
        rows.append([
            Paragraph(str(n), STYLES["table_cell_c"]),
            Paragraph(f"<b>{area}</b>", STYLES["table_cell"]),
            Paragraph(desc, STYLES["table_cell"]),
            Paragraph(effort, ParagraphStyle("e", fontName="Helvetica-Bold", fontSize=9,
                                              textColor=effort_color, leading=12, alignment=TA_CENTER)),
            Paragraph(impact, ParagraphStyle("i", fontName="Helvetica-Bold", fontSize=9,
                                              textColor=impact_color, leading=12, alignment=TA_CENTER)),
        ])
    t = Table(rows, colWidths=col_w)
    t.setStyle(TableStyle(style_list))
    return t

# ── Page templates ───────────────────────────────────────────────────

def cover_page_cb(canvas, doc):
    canvas.saveState()
    # Navy background full page
    canvas.setFillColor(CIC_NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # Gold top bar
    canvas.setFillColor(CIC_GOLD)
    canvas.rect(0, PAGE_H - 1.4*cm, PAGE_W, 1.4*cm, fill=1, stroke=0)
    # Gold bottom bar
    canvas.rect(0, 0, PAGE_W, 1.2*cm, fill=1, stroke=0)
    # Diagonal accent
    canvas.setFillColor(HexColor("#0D2E56"))
    canvas.setStrokeColor(HexColor("#0D2E56"))
    p_path = canvas.beginPath()
    p_path.moveTo(0, PAGE_H * 0.38)
    p_path.lineTo(PAGE_W * 0.55, PAGE_H * 0.55)
    p_path.lineTo(0, PAGE_H * 0.55)
    p_path.close()
    canvas.drawPath(p_path, fill=1, stroke=0)
    # Footer text
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(white)
    canvas.drawCentredString(PAGE_W/2, 0.42*cm, "CONFIDENTIAL — CIC Insurance Group PLC | ClaimsFlow Platform")
    canvas.restoreState()

def body_page_cb(canvas, doc):
    canvas.saveState()
    # Top thin rule
    canvas.setStrokeColor(CIC_NAVY)
    canvas.setLineWidth(0.8)
    canvas.line(MARGIN, PAGE_H - 1.5*cm, PAGE_W - MARGIN, PAGE_H - 1.5*cm)
    # Header text
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(CIC_NAVY)
    canvas.drawString(MARGIN, PAGE_H - 1.25*cm, "ClaimsFlow · System Analysis Report")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY_MID)
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 1.25*cm,
                           f"CIC Insurance Group PLC · Confidential")
    # Bottom rule + page number
    canvas.setStrokeColor(CIC_GOLD)
    canvas.setLineWidth(1.5)
    canvas.line(MARGIN, 1.6*cm, PAGE_W - MARGIN, 1.6*cm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY_MID)
    canvas.drawCentredString(PAGE_W/2, 1.15*cm, f"Page {doc.page}")
    canvas.restoreState()

# ── Document build ───────────────────────────────────────────────────

def build_pdf():
    doc = BaseDocTemplate(
        OUTPUT,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=2.2*cm, bottomMargin=2.2*cm,
        title="ClaimsFlow System Analysis",
        author="Claude Code (AI Analysis)",
    )
    cover_frame = Frame(0, 0, PAGE_W, PAGE_H, leftPadding=MARGIN+0.5*cm,
                        rightPadding=MARGIN+0.5*cm, topPadding=0, bottomPadding=0)
    body_frame  = Frame(MARGIN, 2.2*cm, PAGE_W - 2*MARGIN, PAGE_H - 4.4*cm)

    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=cover_page_cb),
        PageTemplate(id="Body",  frames=[body_frame],  onPage=body_page_cb),
    ])

    story = []

    # ════════════════════════════════════════════════════════════════
    # COVER PAGE
    # ════════════════════════════════════════════════════════════════
    story.append(sp(5.5*cm))
    story.append(p("ClaimsFlow", "cover_title"))
    story.append(sp(0.3*cm))
    story.append(p("System Analysis Report", "cover_sub"))
    story.append(sp(0.15*cm))
    story.append(p("Strengths · Gaps · Strategic Improvements", "cover_sub"))
    story.append(sp(2.5*cm))
    story.append(p("CIC Insurance Group PLC", "cover_meta"))
    story.append(sp(0.15*cm))
    story.append(p(f"Prepared: {datetime.date.today().strftime('%B %d, %Y')}", "cover_meta"))
    story.append(sp(0.15*cm))
    story.append(p("Sector: InsurTech / Medical Claims Automation", "cover_meta"))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # SECTION 1 — EXECUTIVE SUMMARY
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("1.  Executive Summary"))
    story.append(sp(6))
    story.append(p(
        "ClaimsFlow is a well-structured, full-stack medical insurance claims management platform "
        "built for CIC Insurance Group PLC. The system covers the complete claim lifecycle — from "
        "batch submission and multi-model OCR extraction through maker-checker dual approval, fraud "
        "signal detection, provider management, and reporting. The technology stack (NestJS + React 18 + "
        "PostgreSQL + BullMQ) is modern, appropriate for the problem domain, and properly containerised "
        "with Docker."
    ))
    story.append(sp(4))
    story.append(info_box(
        "<b>Key finding:</b> The platform is approximately 85% feature-complete and represents a strong "
        "foundation. However, zero automated test coverage, several disabled integrations, and the absence "
        "of production-grade hardening create meaningful risk before a full production rollout. The "
        "recommendations in this report are prioritised by impact and sector-specific relevance."
    ))
    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 2 — WHAT THE SYSTEM DOES WELL
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("2.  What the System Does Well"))
    story.append(sp(6))

    strengths = [
        ("<b>Maker-Checker Dual Approval</b>",
         "The four-eyes principle is correctly implemented as a first-class workflow. Every claim "
         "passes through an independent maker review then a checker review before finalisation — a "
         "regulatory requirement in Kenyan insurance and an industry best practice globally."),
        ("<b>Multi-Model OCR Pipeline</b>",
         "The system intelligently routes documents through Gemini Vision (cloud), Tesseract.js "
         "(client-side), and OLLAMA (local LLM) depending on availability. Graceful fallback "
         "prevents total failure when a provider is down."),
        ("<b>Fraud Signal Detection</b>",
         "Seven automated fraud patterns are checked at submission time: duplicate invoice numbers, "
         "provider mismatch, negative amounts, unusually high claim values, and more. This gives the "
         "fraud queue officers a pre-filtered, actionable queue."),
        ("<b>Activity Audit Trail</b>",
         "A global NestJS interceptor logs every user action with IP address, user ID, and "
         "timestamp. This is essential for both regulatory audit submissions and internal incident "
         "investigation."),
        ("<b>Barcode-Based Claim Identity</b>",
         "Code-128 barcodes embedded in PDFs give each claim a scannable physical identity "
         "(CIC-YYYYMMDD-XXX-XXXXX). Physical and digital records stay in sync even when documents "
         "are printed, scanned, and re-ingested."),
        ("<b>Role-Based Access Control</b>",
         "Five distinct roles (admin, supervisor, claims officer, checker, fraud officer) with "
         "fine-grained resource-action permissions ensure that each user sees only what they are "
         "authorised for — preventing accidental or deliberate data leakage across departments."),
        ("<b>Modular Architecture</b>",
         "19 NestJS modules cleanly separate concerns. New integrations (payment gateway, e-health "
         "systems) can be added as new modules without touching existing logic."),
    ]

    for title, desc in strengths:
        story.append(KeepTogether([
            p(f"✓  {title}", "body_bold"),
            p(desc, "body"),
            sp(2),
        ]))

    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 3 — GAPS & WHAT SHOULD BE DONE DIFFERENTLY
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("3.  Gaps & What I Would Do Differently"))
    story.append(sp(6))

    story.append(h2("3.1  Automated Testing — Critical Gap"))
    story.append(p(
        "The single largest risk in this codebase is the <b>complete absence of automated tests</b>. "
        "With ~49,000 lines of TypeScript and 179+ API endpoints, any refactoring, dependency "
        "upgrade, or new feature can silently break existing workflows. In an insurance context "
        "where incorrect claim decisions have financial and legal consequences, this is not "
        "acceptable for production."
    ))
    story.append(sp(3))
    story.append(p("<b>Recommended actions:</b>", "body_bold"))
    story.append(bullet("Write Jest unit tests for all service classes (OCR routing logic, fraud signal detection, assignment strategies, completeness validation rules)."))
    story.append(bullet("Write NestJS integration tests using SuperTest against a test Postgres database — do not mock the database; use real queries to catch schema migrations."))
    story.append(bullet("Write Playwright end-to-end tests for the three most critical user journeys: batch upload → OCR → maker approve → checker approve, provider onboarding, and fraud queue triage."))
    story.append(bullet("Set a coverage gate of ≥80% for the service layer in CI — PRs below threshold are blocked from merging."))
    story.append(sp(6))

    story.append(h2("3.2  EDMS & eOxegen Integrations — Skeleton Only"))
    story.append(p(
        "The Electronic Document Management System (EDMS) and eOxegen payment system integrations "
        "are stub files with no real API calls. Without EDMS, approved claims exist only inside "
        "ClaimsFlow and are not archived to the enterprise document store. Without eOxegen, "
        "payment disbursement cannot be triggered from within the platform — a manual step remains."
    ))
    story.append(sp(3))
    story.append(p("<b>Recommended actions:</b>", "body_bold"))
    story.append(bullet("Obtain EDMS API specifications from the enterprise IT team and implement authenticated document push on claim approval."))
    story.append(bullet("Obtain eOxegen API specifications and implement automated payment initiation with a reconciliation webhook listener to update claim status to 'paid'."))
    story.append(bullet("Add integration-level circuit breakers (e.g., using the 'cockatiel' library) so that EDMS/eOxegen downtime degrades gracefully instead of failing claims."))
    story.append(sp(6))

    story.append(h2("3.3  Two-Factor Authentication — Backend Disabled"))
    story.append(p(
        "The 2FA backend controller and service files are renamed with a <b>.disabled</b> extension, "
        "meaning the frontend 2FA setup page is non-functional. Given that ClaimsFlow handles "
        "sensitive personal health and financial data, 2FA should be mandatory for all privileged "
        "roles (admin, supervisor, checker) per data protection best practice."
    ))
    story.append(sp(3))
    story.append(p("<b>Recommended actions:</b>", "body_bold"))
    story.append(bullet("Re-enable the TOTP controller and service, wire them back into app.module.ts."))
    story.append(bullet("Make 2FA mandatory (not optional) for the admin, supervisor, and checker roles — enforced server-side in the JWT strategy."))
    story.append(bullet("Add SMS-based OTP as a fallback via Africa's Talking (already integrated) for users without a TOTP app."))
    story.append(sp(6))

    story.append(h2("3.4  Security Hardening"))
    story.append(p("Several security settings are acceptable for MVP but need tightening before handling real policyholder data:"))
    story.append(sp(3))

    sec_rows = [
        ["Issue", "Current State", "Recommended Change"],
        ["JWT Token Lifetime", "7 days — very long for session tokens", "Shorten to 15 minutes + introduce refresh tokens (30-day sliding window)"],
        ["CORS", "All localhost ports allowed — insecure", "Restrict CORS to the specific production domain only"],
        ["Rate Limiting", "Global throttler only (no per-endpoint limits)", "Add stricter limits on /auth/login (5 req/min), /auth/reset-password, and batch-upload endpoints"],
        ["CSRF Protection", "No CSRF middleware configured", "Add csurf or implement SameSite=Strict cookies for session-bearing routes"],
        ["Docker Secrets", "Hardcoded credentials in docker-compose.yml", "Use Docker secrets or an environment variable file excluded from version control"],
        ["BigInt JSON Precision", "BigInt serialised without explicit handling", "Add global BigInt.prototype.toJSON override in main.ts"],
    ]
    t = Table(
        [[Paragraph(c, STYLES["table_hdr"] if i == 0 else STYLES["table_cell"]) for c in row]
         for i, row in enumerate(sec_rows)],
        colWidths=[4*cm, 5.5*cm, 7.5*cm]
    )
    t.setStyle(TableStyle([
        ("GRID",          (0,0),(-1,-1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND",    (0,0),(-1,0),  CIC_RED),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [white, GREY_LIGHT]),
        ("TOPPADDING",    (0,0),(-1,-1), 5),
        ("BOTTOMPADDING", (0,0),(-1,-1), 5),
        ("LEFTPADDING",   (0,0),(-1,-1), 6),
        ("RIGHTPADDING",  (0,0),(-1,-1), 6),
        ("VALIGN",        (0,0),(-1,-1), "TOP"),
    ]))
    story.append(t)
    story.append(sp(6))

    story.append(h2("3.5  Database Performance & Reliability"))
    story.append(p(
        "The Prisma schema has 30 models but sparse indexing beyond primary keys. At production "
        "claim volumes (100,000+ claims per year is typical for a mid-size insurer), queries on "
        "claim status, provider ID, and submission date will perform full table scans."
    ))
    story.append(sp(3))
    story.append(p("<b>Recommended actions:</b>", "body_bold"))
    story.append(bullet("Add composite indexes on (providerId, status), (batchId, status), and (submittedAt DESC) in schema.prisma."))
    story.append(bullet("Implement soft-deletes using a deletedAt nullable timestamp — hard deletes violate insurance record retention regulations."))
    story.append(bullet("Add database-level constraints for enum fields (Prisma enums are not enforced at the database layer by default)."))
    story.append(bullet("Consider read replicas for the reports module — heavy analytics queries should not compete with transactional claim processing."))
    story.append(sp(6))

    story.append(h2("3.6  API Documentation — Missing"))
    story.append(p(
        "179+ REST endpoints have no Swagger/OpenAPI documentation. Provider integrations, "
        "third-party system connections, and internal developer onboarding all depend on this."
    ))
    story.append(sp(3))
    story.append(p("<b>Recommended actions:</b>", "body_bold"))
    story.append(bullet("Add @nestjs/swagger and decorate all controllers and DTOs — NestJS generates the full spec automatically."))
    story.append(bullet("Enable the Swagger UI at /api/docs behind an admin-only bearer token guard."))
    story.append(bullet("Publish the OpenAPI JSON to a developer portal or Postman collection for external provider integrations."))
    story.append(sp(6))

    story.append(h2("3.7  Observability & Incident Response — Absent"))
    story.append(p(
        "Currently, logging goes to local rotating files only. In production, an undetected "
        "queue backlog or OCR failure can silently block claims for hours before anyone notices."
    ))
    story.append(sp(3))
    story.append(p("<b>Recommended actions:</b>", "body_bold"))
    story.append(bullet("Ship Winston logs to a centralised aggregator — AWS CloudWatch, Datadog, or an on-premise ELK stack (Elasticsearch + Logstash + Kibana)."))
    story.append(bullet("Add structured JSON log format with correlation IDs per request so a single claim's lifecycle can be traced across OCR, workflow, and notification logs."))
    story.append(bullet("Create a BullMQ dashboard (BullBoard) for real-time queue monitoring — visible to supervisors, not just engineers."))
    story.append(bullet("Set up alerts for: queue depth > 500, OCR failure rate > 5%, notification delivery failures."))
    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 4 — WHAT I WOULD ADD
    # ════════════════════════════════════════════════════════════════
    story.append(PageBreak())
    story.append(coloured_bar("4.  What I Would Add — Feature Recommendations"))
    story.append(sp(6))

    story.append(h2("4.1  Real-Time Collaboration on Claims"))
    story.append(p(
        "Currently, two reviewers can inadvertently open the same claim simultaneously, leading "
        "to conflicting decisions. Insurance workflows benefit enormously from real-time "
        "awareness — who else is viewing a claim, live status changes, and instant notifications "
        "when a colleague completes their step."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("Add a WebSocket module using @nestjs/websockets + Socket.io (or native WebSocket)."))
    story.append(bullet("Emit events on: claim status change, new comment, assignment, approval/rejection."))
    story.append(bullet("Show a 'John is reviewing this claim' presence indicator on the claim detail page."))
    story.append(bullet("Optimistic locking: lock a claim for editing while a reviewer is actively working on it (release after 5 minutes of inactivity or explicit release)."))
    story.append(sp(6))

    story.append(h2("4.2  SLA Tracking & Escalation Engine"))
    story.append(p(
        "The Insurance Regulatory Authority of Kenya (IRA) requires insurers to settle or "
        "respond to claims within defined timeframes. ClaimsFlow has no SLA tracking — a critical "
        "compliance gap. Claims approaching their regulatory deadline should be automatically "
        "escalated, flagged, and reported."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("Add SLA configuration per claim type (e.g., inpatient 72 hours, outpatient 24 hours, pre-authorisation 4 hours)."))
    story.append(bullet("Add a scheduled BullMQ job (cron) that runs every 15 minutes to identify claims approaching SLA breach (>80% elapsed)."))
    story.append(bullet("Auto-escalate breaching claims: reassign to supervisor, send SMS to responsible officer, and flag with a red SLA badge in the UI."))
    story.append(bullet("Add an SLA compliance report to the Reports module — percentage within SLA by claim type, officer, and month."))
    story.append(sp(6))

    story.append(h2("4.3  Provider Self-Service Portal"))
    story.append(p(
        "Hospitals and clinics currently have no direct window into their submitted claims. "
        "They rely on phone calls and emails to CIC staff for status updates — creating "
        "unnecessary inbound call volume and delays. A read-only (or limited-action) provider "
        "portal would dramatically reduce operational overhead."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("Add a Provider role with read-only access limited to their own claims (access control already partially implemented via providerAccessGuard)."))
    story.append(bullet("Build a ProviderPortal page showing: submitted claims, status breakdown, approval rates, outstanding documents required."))
    story.append(bullet("Enable providers to upload supplementary documents directly to an existing claim (with a notification to the assigned officer)."))
    story.append(bullet("Add SMS/email status update opt-in so providers get push notifications without logging in."))
    story.append(sp(6))

    story.append(h2("4.4  AI-Powered Claim Pre-Population"))
    story.append(p(
        "The OCR pipeline extracts text from submitted documents but does not yet auto-fill "
        "claim form fields. Officers manually re-type data that OCR has already extracted — "
        "wasted effort and a source of transcription errors. The infrastructure (Gemini Vision, "
        "Tesseract, document classification) is already in place."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("Extend the OCR service to return structured JSON (patient name, diagnosis codes, invoice amounts, dates, provider number) in addition to raw text."))
    story.append(bullet("Map extracted fields to claim DTO fields and auto-populate the claim form in the UI — officer reviews and confirms rather than types from scratch."))
    story.append(bullet("Show confidence scores alongside each auto-filled field so reviewers know which fields need verification."))
    story.append(bullet("Feed officer corrections back as labelled training data to improve extraction accuracy over time (active learning loop)."))
    story.append(sp(6))

    story.append(h2("4.5  Comprehensive Fraud Score (ML Model)"))
    story.append(p(
        "The current fraud detection checks 7 rule-based patterns. This is a solid starting "
        "point, but sophisticated fraud — split billing, upcoding, collusion between providers "
        "and policyholders — is not detectable by simple rules. A machine learning fraud score "
        "would surface non-obvious anomalies."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("Train a gradient-boosted tree (XGBoost or LightGBM) on historical approved/rejected claims with fraud labels as a starting point."))
    story.append(bullet("Features: provider claim frequency, average invoice amount vs. provider historical mean, claim volume spikes, ICD-10 code clustering per provider."))
    story.append(bullet("Expose the model as a lightweight Python FastAPI microservice — ClaimsFlow backend calls it as an async job during batch processing."))
    story.append(bullet("Display fraud probability score (0–100) alongside existing signal flags in the fraud queue UI."))
    story.append(bullet("Retrain the model monthly on newly labelled data using a scheduled job."))
    story.append(sp(6))

    story.append(h2("4.6  Mobile App for Reviewers & Supervisors"))
    story.append(p(
        "Claim reviewers are often away from their desks. A lightweight React Native (or "
        "Flutter) mobile app allowing makers and checkers to approve, reject, or return claims "
        "with a comment on their phone would compress turnaround times and reduce SLA breaches "
        "during high-volume periods."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("Scope to three screens: Queue list, Claim detail with PDF viewer, Approve/Reject/Return action with comment."))
    story.append(bullet("Reuse existing REST API — no backend changes required."))
    story.append(bullet("Add push notifications (Firebase Cloud Messaging) so officers are notified of new assignments without polling."))
    story.append(sp(6))

    story.append(h2("4.7  CI/CD Pipeline"))
    story.append(p(
        "The repository has no CI/CD configuration. Deployments are manual. "
        "A GitHub Actions pipeline should be the first infrastructure addition after tests exist."
    ))
    story.append(sp(3))
    story.append(p("<b>Implementation:</b>", "body_bold"))
    story.append(bullet("GitHub Actions: lint → type-check → test → build Docker image → push to registry on every PR merge to main."))
    story.append(bullet("Separate staging and production environments with promotion gates."))
    story.append(bullet("Add Dependabot for automated dependency security updates."))
    story.append(bullet("Run OWASP ZAP or Semgrep in the pipeline for static application security testing (SAST) on every build."))
    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 5 — SECTOR ANALYSIS
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("5.  Sector Context — InsurTech / East African Medical Insurance"))
    story.append(sp(6))
    story.append(p(
        "ClaimsFlow operates in the intersection of <b>InsurTech</b> and <b>HealthTech</b> within "
        "the East African insurance market. Understanding the sector dynamics is essential for "
        "prioritising the right improvements."
    ))
    story.append(sp(6))

    sector_rows = [
        ("Regulatory compliance",
         "IRA (Kenya), FSRA (others)",
         "SLA enforcement, mandatory audit logs, data residency"),
        ("Fraud prevalence",
         "10–15% of medical claims industry-wide",
         "Invest in ML fraud scoring; rule-based detection alone is insufficient"),
        ("Provider digitisation",
         "Variable — large hospitals digitised, rural clinics paper-based",
         "Keep batch PDF/scan upload as primary entry point; don't force EDI"),
        ("Policyholder expectations",
         "Shifting to real-time updates",
         "SMS notifications already present; WhatsApp integration would expand reach"),
        ("Market consolidation",
         "M&A activity in East Africa",
         "Multi-tenant architecture would allow CIC to onboard subsidiary insurers"),
        ("NHIF / SHA integration",
         "National health fund interoperability",
         "Future: HL7 FHIR API for cross-scheme claim data exchange"),
        ("Mobile-first population",
         "Kenya has 60%+ mobile internet penetration",
         "Mobile reviewer app and provider WhatsApp submission are high-ROI investments"),
    ]

    hdr = ["Sector Factor", "Current State", "Implication for ClaimsFlow"]
    t = Table(
        [[Paragraph(c, STYLES["table_hdr"]) for c in hdr]] +
        [[Paragraph(str(c), STYLES["table_cell"]) for c in row] for row in sector_rows],
        colWidths=[4.2*cm, 4.8*cm, 8*cm]
    )
    t.setStyle(TableStyle([
        ("GRID",          (0,0),(-1,-1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND",    (0,0),(-1,0),  CIC_TEAL),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [white, GREY_LIGHT]),
        ("TOPPADDING",    (0,0),(-1,-1), 5),
        ("BOTTOMPADDING", (0,0),(-1,-1), 5),
        ("LEFTPADDING",   (0,0),(-1,-1), 6),
        ("RIGHTPADDING",  (0,0),(-1,-1), 6),
        ("VALIGN",        (0,0),(-1,-1), "TOP"),
    ]))
    story.append(t)
    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 6 — PRIORITISED ROADMAP
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("6.  Prioritised Improvement Roadmap"))
    story.append(sp(6))
    story.append(p(
        "The table below ranks all recommendations by effort (Low/Medium/High) and business impact. "
        "Tackle items in order — fixes that unblock everything else come first."
    ))
    story.append(sp(6))

    roadmap_items = [
        ("1",  "Testing",         "Write Jest unit + integration tests; set ≥80% coverage gate in CI", "High",   "High"),
        ("2",  "2FA Re-enable",   "Re-enable TOTP backend, make mandatory for privileged roles",        "Low",    "High"),
        ("3",  "Security",        "Shorten JWT lifetime, tighten CORS, add rate limiting per endpoint", "Low",    "High"),
        ("4",  "CI/CD Pipeline",  "GitHub Actions: lint → test → build → deploy on merge to main",     "Medium", "High"),
        ("5",  "SLA Engine",      "BullMQ cron for SLA monitoring, auto-escalation, supervisor alerts", "Medium", "High"),
        ("6",  "EDMS Integration","Implement authenticated document push on claim approval",            "Medium", "High"),
        ("7",  "eOxegen Payment", "Implement payment initiation + reconciliation webhook",              "Medium", "High"),
        ("8",  "API Docs",        "Add @nestjs/swagger, decorate all controllers and DTOs",            "Low",    "Medium"),
        ("9",  "DB Indexes",      "Add composite indexes; implement soft-deletes for compliance",       "Low",    "High"),
        ("10", "Observability",   "Centralised log aggregation + BullBoard queue dashboard",           "Medium", "Medium"),
        ("11", "OCR Pre-Pop",     "Structured JSON from OCR → auto-fill claim form fields",            "High",   "High"),
        ("12", "Provider Portal", "Read-only provider self-service claim status portal",               "Medium", "Medium"),
        ("13", "Real-Time WS",    "WebSocket presence + live status updates on claim detail",          "Medium", "Medium"),
        ("14", "ML Fraud Score",  "XGBoost fraud probability model as FastAPI microservice",           "High",   "High"),
        ("15", "Mobile App",      "React Native reviewer app: queue, detail, approve/reject",          "High",   "Medium"),
        ("16", "WhatsApp Channel","WhatsApp-based claim status queries + document submission",         "Medium", "Medium"),
    ]

    story.append(priority_table(roadmap_items))
    story.append(sp(6))
    story.append(p("* Effort: Low < 1 week · Medium 1–3 weeks · High > 3 weeks", "caption"))
    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 7 — SYSTEM METRICS SNAPSHOT
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("7.  System Metrics Snapshot"))
    story.append(sp(6))

    metrics = [
        ["Metric", "Value", "Status"],
        ["Backend TypeScript files", "93", "✓"],
        ["Frontend TypeScript / TSX files", "80", "✓"],
        ["Total lines of code", "~49,000", "✓"],
        ["NestJS modules", "19", "✓"],
        ["REST API endpoints", "179+", "✓"],
        ["Database models (Prisma)", "30", "✓"],
        ["Frontend pages", "27", "✓"],
        ["Background job processors", "4", "✓"],
        ["Automated test files", "0", "⚠ Critical"],
        ["Global exception filters", "0", "⚠ Gap"],
        ["Swagger / OpenAPI spec", "None", "⚠ Gap"],
        ["Active integrations (EDMS, eOxegen)", "0 of 2", "⚠ Pending"],
        ["2FA backend controllers active", "0", "⚠ Disabled"],
        ["Fraud detection rules", "7", "✓"],
        ["OCR model providers supported", "3", "✓"],
    ]

    status_colors = {
        "✓": CIC_GREEN,
        "⚠ Critical": CIC_RED,
        "⚠ Gap": CIC_ORANGE,
        "⚠ Pending": CIC_ORANGE,
        "⚠ Disabled": CIC_ORANGE,
    }

    cell_data = []
    for i, row in enumerate(metrics):
        if i == 0:
            cell_data.append([Paragraph(c, STYLES["table_hdr"]) for c in row])
        else:
            sc = status_colors.get(row[2], black)
            cell_data.append([
                Paragraph(row[0], STYLES["table_cell"]),
                Paragraph(row[1], STYLES["table_cell_c"]),
                Paragraph(row[2], ParagraphStyle("sc", fontName="Helvetica-Bold", fontSize=9,
                                                  textColor=sc, leading=12, alignment=TA_CENTER)),
            ])

    t = Table(cell_data, colWidths=[9*cm, 3*cm, 5*cm])
    t.setStyle(TableStyle([
        ("GRID",          (0,0),(-1,-1), 0.4, HexColor("#CCCCCC")),
        ("BACKGROUND",    (0,0),(-1,0),  CIC_NAVY),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [white, GREY_LIGHT]),
        ("TOPPADDING",    (0,0),(-1,-1), 5),
        ("BOTTOMPADDING", (0,0),(-1,-1), 5),
        ("LEFTPADDING",   (0,0),(-1,-1), 6),
        ("RIGHTPADDING",  (0,0),(-1,-1), 6),
        ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
    ]))
    story.append(t)
    story.append(sp(10))

    # ════════════════════════════════════════════════════════════════
    # SECTION 8 — CONCLUSION
    # ════════════════════════════════════════════════════════════════
    story.append(coloured_bar("8.  Conclusion"))
    story.append(sp(6))
    story.append(p(
        "ClaimsFlow is a commercially viable, architecturally sound insurance claims platform. "
        "The technology choices are appropriate, the domain modelling is correct, and the "
        "core workflows — batch ingestion, OCR, maker-checker approval, fraud flagging — function "
        "as designed. The codebase represents significant engineering investment and is closer "
        "to production than most platforms at this stage."
    ))
    story.append(sp(4))
    story.append(p(
        "The path to a hardened production deployment is clear and achievable. The single "
        "most important action is establishing automated test coverage — everything else "
        "builds on that foundation. After that, completing the EDMS and eOxegen integrations "
        "closes the last gaps in the core claim lifecycle. Security hardening and SLA "
        "enforcement are compliance necessities that should be addressed before the platform "
        "handles live policyholder data."
    ))
    story.append(sp(4))
    story.append(p(
        "The strategic additions — AI pre-population, ML fraud scoring, a provider self-service "
        "portal, and SLA enforcement — are not luxuries. In the competitive East African "
        "InsurTech market, they are the features that will differentiate CIC from legacy "
        "claims processors and enable ClaimsFlow to become a platform that providers, "
        "reviewers, and policyholders actively want to use."
    ))
    story.append(sp(8))
    story.append(info_box(
        "<b>Bottom line:</b> Fix the foundation (tests, security, integrations) in the next sprint. "
        "Then build the differentiators (SLA engine, AI pre-population, provider portal) in the "
        "following quarter. The system will be ready for full production rollout within 2–3 months "
        "of focused engineering effort."
    ))
    story.append(sp(8))
    story.append(hr(color=CIC_GOLD, width=1.5))
    story.append(sp(4))
    story.append(p(
        f"Report generated {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} · "
        "Analysis by Claude Code (Anthropic) · CIC Insurance Group PLC",
        "caption"
    ))

    doc.build(story)
    print(f"PDF generated: {OUTPUT}")

if __name__ == "__main__":
    build_pdf()
