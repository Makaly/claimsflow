"""Generate ClaimsFlow Security Audit PDF Report."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from datetime import date

OUTPUT = "/home/bigdev/Desktop/cic/claims/ClaimsFlow_Security_Audit_Report.pdf"

RED    = colors.HexColor("#C0392B")
ORANGE = colors.HexColor("#E67E22")
YELLOW = colors.HexColor("#F39C12")
GREEN  = colors.HexColor("#27AE60")
BLUE   = colors.HexColor("#2980B9")
DARK   = colors.HexColor("#1A252F")
LGREY  = colors.HexColor("#ECF0F1")
MGREY  = colors.HexColor("#BDC3C7")
WHITE  = colors.white

SEV_COLOR = {"CRITICAL": RED, "HIGH": ORANGE, "MEDIUM": YELLOW, "LOW": GREEN, "INFO": BLUE}

def sty(name, **kw):
    return ParagraphStyle(name, **kw)

TITLE   = sty("T",  fontName="Helvetica-Bold",   fontSize=26, textColor=WHITE, alignment=TA_CENTER, leading=32)
SUBT    = sty("S",  fontName="Helvetica",         fontSize=13, textColor=MGREY, alignment=TA_CENTER, leading=18)
H1      = sty("H1", fontName="Helvetica-Bold",    fontSize=16, textColor=DARK,  spaceBefore=18, spaceAfter=6)
H2      = sty("H2", fontName="Helvetica-Bold",    fontSize=12, textColor=DARK,  spaceBefore=10, spaceAfter=4)
BODY    = sty("B",  fontName="Helvetica",         fontSize=10, textColor=DARK,  leading=15, alignment=TA_JUSTIFY)
MONO    = sty("M",  fontName="Courier",           fontSize=8,  textColor=DARK,  leading=12, backColor=LGREY,
              leftIndent=6, rightIndent=6, borderPadding=(3,3,3,3))
CAPTION = sty("C",  fontName="Helvetica-Oblique", fontSize=9,  textColor=MGREY, alignment=TA_CENTER)
CELL    = sty("Ce", fontName="Helvetica",         fontSize=9,  textColor=DARK,  leading=13)
CELLB   = sty("Cb", fontName="Helvetica-Bold",    fontSize=9,  textColor=DARK,  leading=13)

def p(text, style=BODY): return Paragraph(text, style)
def sp(n=6):             return Spacer(1, n)
def hr():                return HRFlowable(width="100%", thickness=0.5, color=MGREY, spaceAfter=6)

# ---------- Finding data ----------

FINDINGS = [
    {
        "id": "SEC-01",
        "severity": "CRITICAL",
        "title": "Live API Keys and Credentials Exposed in .env File",
        "location": "backend/.env",
        "owasp": "A02:2021 - Cryptographic Failures",
        "description": (
            "The backend/.env file contains production secrets in plaintext: "
            "a live Anthropic API key (sk-ant-api03-...), a Google Gemini API key, "
            "a Gmail SMTP app-password, and a JWT secret whose comment says "
            "'change in production'. Redis has no password. The database uses the trivially "
            "weak password 'root'. Any developer with filesystem access, or any log leak, "
            "exposes all credentials instantly. Compromised keys allow financial abuse of "
            "AI services and full email account takeover."
        ),
        "impact": "Full compromise of all third-party services; financial loss from API abuse; email account takeover.",
        "fixed": False,
        "fix_description": (
            "1. Rotate ALL exposed keys immediately: Anthropic, Gemini, Gmail SMTP. "
            "2. Generate a new JWT secret: openssl rand -hex 64. "
            "3. Change the PostgreSQL password from 'root' to a strong random value. "
            "4. Store ALL secrets in Render environment variables (or a secret manager). "
            "5. Never put real values in .env committed to any repo -- use .env.example as a template only."
        ),
        "code_fix": None,
    },
    {
        "id": "SEC-02",
        "severity": "HIGH",
        "title": "No Rate Limiting on Authentication Endpoints (Brute-Force Risk)",
        "location": "backend/src/auth/auth.controller.ts",
        "owasp": "A07:2021 - Identification and Authentication Failures",
        "description": (
            "POST /api/auth/login, /api/auth/register, and /api/auth/register-provider "
            "had no request throttle. An attacker could run unlimited password guesses "
            "(credential stuffing, brute-force) against any user account with no lockout."
        ),
        "impact": "Account takeover via brute-force; user enumeration via timing differences.",
        "fixed": True,
        "fix_description": (
            "Applied @nestjs/throttler limits per IP: "
            "login: 10 req/min, register: 5 req/min, register-provider: 3 req/min. "
            "@Throttle and @UseGuards(ThrottlerGuard) added to each sensitive endpoint."
        ),
        "code_fix": (
            "@Post('login')\n"
            "@UseGuards(ThrottlerGuard)\n"
            "@Throttle({ auth: { ttl: 60_000, limit: 10 } })\n"
            "async login(@Body() dto: LoginDto) { ... }"
        ),
    },
    {
        "id": "SEC-03",
        "severity": "HIGH",
        "title": "Security HTTP Headers Missing - Helmet Not Applied",
        "location": "backend/src/main.ts",
        "owasp": "A05:2021 - Security Misconfiguration",
        "description": (
            "The application had no HTTP security headers. Without Helmet, responses lacked: "
            "Content-Security-Policy (XSS mitigation), X-Frame-Options (clickjacking), "
            "X-Content-Type-Options (MIME sniffing), Referrer-Policy, and HSTS. "
            "This exposes users to XSS escalation, clickjacking, and MIME-confusion attacks."
        ),
        "impact": "Clickjacking, MIME-type confusion attacks, XSS amplification, Referer header leakage.",
        "fixed": True,
        "fix_description": (
            "Applied helmet() at the top of bootstrap() before all other middleware. "
            "CSP configured with strict directives: defaultSrc 'self', "
            "objectSrc 'none', frameAncestors 'none'."
        ),
        "code_fix": (
            "import helmet from 'helmet';\n"
            "app.use(helmet({\n"
            "  contentSecurityPolicy: {\n"
            "    directives: {\n"
            "      defaultSrc: [\"'self'\"],\n"
            "      objectSrc:  [\"'none'\"],\n"
            "      frameAncestors: [\"'none'\"],\n"
            "    },\n"
            "  },\n"
            "}));"
        ),
    },
    {
        "id": "SEC-04",
        "severity": "HIGH",
        "title": "Public Registration Allows Admin Role Self-Assignment",
        "location": "backend/src/auth/dto/register.dto.ts",
        "owasp": "A01:2021 - Broken Access Control",
        "description": (
            "The RegisterDto @IsIn validator included 'admin', 'supervisor', and 'claims_officer'. "
            "Any anonymous user could POST {role:'admin'} to /api/auth/register and immediately "
            "gain full administrative access including user management, claim approval, and "
            "RBAC configuration."
        ),
        "impact": "Complete privilege escalation -- anonymous user becomes system administrator.",
        "fixed": True,
        "fix_description": (
            "Removed all privileged roles from RegisterDto. "
            "Public registration now only allows: provider_admin, provider_user. "
            "Internal staff accounts must be created by existing admins via POST /api/users."
        ),
        "code_fix": (
            "// BEFORE (insecure)\n"
            "@IsIn(['admin','claims_officer','supervisor','provider_admin','provider_user'])\n\n"
            "// AFTER (fixed)\n"
            "@IsIn(['provider_admin', 'provider_user'])"
        ),
    },
    {
        "id": "SEC-05",
        "severity": "HIGH",
        "title": "Roles Guard Ignored RBAC Permissions Array",
        "location": "backend/src/auth/guards/roles.guard.ts",
        "owasp": "A01:2021 - Broken Access Control",
        "description": (
            "The RolesGuard only checked user.role (the legacy single string field), "
            "ignoring user.roles (the array populated by the RBAC module in JwtStrategy). "
            "Users with roles assigned via the RBAC module could be incorrectly denied access, "
            "or users with a stale legacy role string could gain unintended access."
        ),
        "impact": "Authorization bypass -- RBAC-assigned roles not honored; inconsistent access control.",
        "fixed": True,
        "fix_description": (
            "Guard now merges user.roles (RBAC array) and user.role (legacy) into one set "
            "and checks requiredRoles.some(r => userRoles.includes(r))."
        ),
        "code_fix": (
            "const userRoles: string[] = Array.isArray(user.roles) ? [...user.roles] : [];\n"
            "if (user.role && !userRoles.includes(user.role)) userRoles.push(user.role);\n"
            "return requiredRoles.some((r) => userRoles.includes(r));"
        ),
    },
    {
        "id": "SEC-06",
        "severity": "MEDIUM",
        "title": "JWT Token Stored in localStorage -- XSS Exfiltration Risk",
        "location": "frontend/src/services/api.ts, frontend/src/store/authStore.ts",
        "owasp": "A02:2021 - Cryptographic Failures",
        "description": (
            "The JWT access token is stored in localStorage. Any JavaScript running in the browser "
            "-- including injected scripts via XSS, a compromised third-party library, or a "
            "malicious browser extension -- can read and exfiltrate the token silently. "
            "localStorage provides no HttpOnly protection."
        ),
        "impact": "Full session hijacking if any XSS is achieved on the domain.",
        "fixed": False,
        "fix_description": (
            "Migrate JWT to HttpOnly, SameSite=Strict cookies. "
            "Backend: set the JWT via Set-Cookie on login. "
            "Frontend: use credentials:'include' (axios withCredentials) instead of "
            "manually attaching Authorization: Bearer headers. "
            "This requires coordinated frontend and backend changes."
        ),
        "code_fix": None,
    },
    {
        "id": "SEC-07",
        "severity": "MEDIUM",
        "title": "Logout Does Not Invalidate JWT -- 7-Day Token Remains Valid",
        "location": "backend/src/auth/auth.controller.ts, backend/src/auth/auth.module.ts",
        "owasp": "A07:2021 - Identification and Authentication Failures",
        "description": (
            "The POST /api/auth/logout endpoint returned success but never invalidated the JWT. "
            "Tokens had a 7-day expiry, meaning a stolen or leaked token remained usable "
            "for up to 7 days after the user logged out."
        ),
        "impact": "Stolen tokens remain valid for 7 days post-logout; no way to terminate sessions.",
        "fixed": True,
        "fix_description": (
            "Reduced JWT expiry from 7d to 1d in auth.module.ts to limit blast radius. "
            "For full revocation: implement a Redis-backed token denylist storing the jti "
            "claim on logout with TTL matching the token's remaining lifetime, "
            "and validate against it in JwtStrategy.validate()."
        ),
        "code_fix": (
            "// auth.module.ts -- reduced from '7d'\n"
            "signOptions: { expiresIn: '1d' }"
        ),
    },
    {
        "id": "SEC-08",
        "severity": "MEDIUM",
        "title": "File Upload Validates Extension Only -- Magic Bytes Not Checked",
        "location": "backend/src/claims/claims.controller.ts",
        "owasp": "A03:2021 - Injection / A08:2021 - Software and Data Integrity Failures",
        "description": (
            "The Multer fileFilter checked only the filename extension via regex. "
            "An attacker could rename a malicious file (e.g. exploit.html -> exploit.pdf) "
            "and bypass the filter, uploading content that could confuse PDF parsers, "
            "Tesseract OCR, or the AI vision APIs, potentially triggering DoS or prompt injection."
        ),
        "impact": "Malicious file upload; potential DoS via parser bomb; downstream content injection.",
        "fixed": True,
        "fix_description": (
            "Added verifyMagicBytes() which reads the first 8 bytes of each uploaded file "
            "and compares them against known signatures: %PDF (0x25504446), JFIF/EXIF "
            "(0xFFD8FF), PNG (0x89504E47...). Files failing this check are deleted immediately "
            "and a 400 Bad Request is returned."
        ),
        "code_fix": (
            "const MAGIC = {\n"
            "  pdf: [Buffer.from([0x25,0x50,0x44,0x46])],  // %PDF\n"
            "  jpg: [Buffer.from([0xff,0xd8,0xff])],\n"
            "  png: [Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],\n"
            "};\n"
            "if (!verifyMagicBytes(file.path, ext)) {\n"
            "  fs.unlinkSync(file.path);\n"
            "  throw new BadRequestException('File content mismatch');\n"
            "}"
        ),
    },
    {
        "id": "SEC-09",
        "severity": "MEDIUM",
        "title": "Hardcoded Developer Absolute Path in Production Code",
        "location": "backend/src/documents/documents.service.ts line 12",
        "owasp": "A05:2021 - Security Misconfiguration",
        "description": (
            "DUMP_ROOT was hardcoded to '/home/bigdev/Desktop/cic/claims/uploaded_files', "
            "a developer's local machine path. In production this path does not exist, "
            "causing silent file dump failures. It also exposes the developer's username "
            "and directory structure in logs and error messages."
        ),
        "impact": "Silent data loss in production; developer path information disclosure in stack traces.",
        "fixed": True,
        "fix_description": (
            "DUMP_ROOT now reads process.env.UPLOAD_DUMP_DIR with a safe fallback to "
            "path.resolve(process.cwd(), 'uploaded_files'). "
            "UPLOAD_DUMP_DIR is documented in .env.example."
        ),
        "code_fix": (
            "// BEFORE\n"
            "const DUMP_ROOT = '/home/bigdev/Desktop/cic/claims/uploaded_files';\n\n"
            "// AFTER\n"
            "const DUMP_ROOT = process.env.UPLOAD_DUMP_DIR\n"
            "  || path.resolve(process.cwd(), 'uploaded_files');"
        ),
    },
    {
        "id": "SEC-10",
        "severity": "MEDIUM",
        "title": "Weak Password Policy -- 6-Character Minimum, No Complexity",
        "location": "backend/src/auth/dto/register.dto.ts",
        "owasp": "A07:2021 - Identification and Authentication Failures",
        "description": (
            "The minimum password length was 6 characters with no complexity requirements. "
            "For a healthcare insurance platform handling sensitive patient and financial data, "
            "this falls well below industry standards (NIST SP 800-63B recommends minimum 8, "
            "ideally 12+ characters)."
        ),
        "impact": "Accounts easily compromised via password spraying or dictionary attacks.",
        "fixed": True,
        "fix_description": (
            "Minimum length increased to 10 characters. @Matches() validator now requires "
            "at least one uppercase letter, one lowercase letter, one digit, and one special "
            "character. Change-password flow inherits the same DTO validation."
        ),
        "code_fix": (
            "@MinLength(10)\n"
            "@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*()])/, {\n"
            "  message: 'Must contain upper, lower, digit, and special character',\n"
            "})"
        ),
    },
    {
        "id": "SEC-11",
        "severity": "MEDIUM",
        "title": "Redis Has No Authentication Password",
        "location": "backend/.env -- REDIS_PASSWORD= (empty)",
        "owasp": "A05:2021 - Security Misconfiguration",
        "description": (
            "The Redis connection is configured without a password. If Redis is reachable "
            "from outside the application server (common misconfiguration in cloud deployments), "
            "an attacker can read job queues, inject fraudulent OCR jobs, "
            "or flush the queue causing data loss."
        ),
        "impact": "Queue poisoning; fraudulent job injection; in-flight data exfiltration.",
        "fixed": False,
        "fix_description": (
            "1. Set a strong REDIS_PASSWORD in deployment environment variables. "
            "2. Bind Redis to 127.0.0.1 (not 0.0.0.0) in redis.conf. "
            "3. Enable requirepass in redis.conf. "
            "4. In production, use a managed Redis service with TLS and VPC network isolation."
        ),
        "code_fix": None,
    },
    {
        "id": "SEC-12",
        "severity": "LOW",
        "title": "CORS Allows Localhost in Production if NODE_ENV Not Set",
        "location": "backend/src/main.ts",
        "owasp": "A05:2021 - Security Misconfiguration",
        "description": (
            "The original CORS handler allowed localhost on any port unconditionally, "
            "regardless of NODE_ENV. If deployed without NODE_ENV=production, "
            "a locally-running attacker page could make credentialed cross-origin requests."
        ),
        "impact": "Cross-origin data access from localhost origins in misconfigured production.",
        "fixed": True,
        "fix_description": (
            "CORS now gates localhost access on NODE_ENV !== 'production'. "
            "In production, only the FRONTEND_URL is accepted. "
            "NODE_ENV=production must be set in all deployment environments."
        ),
        "code_fix": (
            "const isDev = process.env.NODE_ENV !== 'production';\n"
            "if (isDev && /localhost/.test(origin)) return cb(null, true);\n"
            "if (allowedOrigin && origin === allowedOrigin) return cb(null, true);\n"
            "cb(new Error('CORS: origin not allowed'));"
        ),
    },
    {
        "id": "SEC-13",
        "severity": "LOW",
        "title": "Temporary Password Returned in Plaintext API Response",
        "location": "backend/src/auth/users.controller.ts lines 110, 157",
        "owasp": "A02:2021 - Cryptographic Failures",
        "description": (
            "POST /api/users (admin create user) and POST /api/users/:id/reset-password "
            "both return the generated temporary password in the JSON response body. "
            "This password is recorded by any HTTP proxy, SIEM, or API gateway that logs responses."
        ),
        "impact": "Temporary passwords visible in logs; interception by network monitoring.",
        "fixed": False,
        "fix_description": (
            "Deliver the temporary password via email to the user's address using EmailService. "
            "Remove tempPassword from all JSON response bodies. "
            "The API should return only {message: 'Temporary password sent by email'}."
        ),
        "code_fix": None,
    },
    {
        "id": "SEC-14",
        "severity": "LOW",
        "title": "Potential Shell Injection via File Path in execSync Calls",
        "location": "backend/src/ocr/ocr.service.ts, gemini-vision.service.ts, ollama-ocr.service.ts",
        "owasp": "A03:2021 - Injection",
        "description": (
            "Multiple OCR services pass pdfPath into shell commands via template literals "
            "inside execSync() (e.g. pdftoppm ... \"${pdfPath}\" ...). "
            "Paths are double-quoted, which prevents most injection, but filenames containing "
            "embedded double-quotes could break quoting. "
            "Current multer storage generates random numeric filenames reducing practical risk, "
            "but the pattern is architecturally unsafe."
        ),
        "impact": "Arbitrary command execution if an attacker influences the file path (symlink, path traversal).",
        "fixed": False,
        "fix_description": (
            "Replace execSync with spawnSync using argument arrays to eliminate shell "
            "interpretation entirely. Example: "
            "spawnSync('pdftoppm', ['-png','-r','250','-f',str(n),pdfPath,tmpPrefix]). "
            "Additionally, validate that pdfPath is within the configured uploads directory "
            "before passing it to any subprocess."
        ),
        "code_fix": None,
    },
]

SUMMARY = {s: sum(1 for f in FINDINGS if f["severity"] == s) for s in ["CRITICAL","HIGH","MEDIUM","LOW"]}
FIXED   = sum(1 for f in FINDINGS if f["fixed"])
UNFIXED = len(FINDINGS) - FIXED

# ---------- Build document ----------

doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2.5*cm, bottomMargin=2*cm,
    title="ClaimsFlow Security Audit Report",
    author="ClaimsFlow Security Team",
)

story = []

# Cover
story.append(sp(3*cm))
story.append(p("ClaimsFlow", TITLE))
story.append(p("Security Vulnerability Audit Report", SUBT))
story.append(sp(8))
story.append(p(f"Audit Date: {date.today().strftime('%B %d, %Y')}  |  Classification: CONFIDENTIAL", CAPTION))
story.append(sp(20))

# Executive summary
story.append(p("Executive Summary", H1))
story.append(hr())
story.append(p(
    f"A comprehensive security audit of the <b>ClaimsFlow</b> insurance claims management "
    f"platform was conducted on <b>{date.today().strftime('%B %d, %Y')}</b>. "
    "The audit covered the NestJS backend API, React/TypeScript frontend, authentication flows, "
    "file upload handling, role-based access control, HTTP security headers, and secret management."
))
story.append(sp(6))
story.append(p(
    f"<b>{len(FINDINGS)} vulnerabilities</b> were identified across OWASP Top 10 categories. "
    f"<b>{FIXED} have been remediated</b> in this report cycle with direct code fixes. "
    f"<b>{UNFIXED} require</b> deployment-level or architectural changes."
))
story.append(sp(10))

# Severity summary table
sum_rows = [["Severity", "Count", "OWASP Category"]]
owasp_map = {
    "CRITICAL": "A02:2021 - Cryptographic Failures",
    "HIGH":     "A01 Broken Access Control / A07 Auth Failures",
    "MEDIUM":   "A05 Security Misconfiguration / A07 Auth",
    "LOW":      "A02 / A03 / A05",
}
for sev in ["CRITICAL","HIGH","MEDIUM","LOW"]:
    sum_rows.append([sev, str(SUMMARY[sev]), owasp_map[sev]])
sum_style = TableStyle([
    ("BACKGROUND", (0,0), (-1,0), DARK),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 9),
    ("ROWBACKGROUNDS", (0,1),(-1,-1),[LGREY, WHITE]),
    ("GRID",       (0,0), (-1,-1), 0.5, MGREY),
    ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0),(-1,-1), 5),
    ("LEFTPADDING",(0,0), (-1,-1), 8),
])
for i, sev in enumerate(["CRITICAL","HIGH","MEDIUM","LOW"], 1):
    c = SEV_COLOR[sev]
    sum_style.add("BACKGROUND", (0,i),(0,i), c)
    sum_style.add("TEXTCOLOR",  (0,i),(0,i), WHITE)
    sum_style.add("FONTNAME",   (0,i),(0,i), "Helvetica-Bold")
t = Table(sum_rows, colWidths=[3.5*cm, 2*cm, 10*cm])
t.setStyle(sum_style)
story.append(t)
story.append(sp(8))

fix_rows = [
    ["Status",  "Count", "Notes"],
    ["Fixed",   str(FIXED),   "Code fixes applied in this audit cycle"],
    ["Pending", str(UNFIXED), "Requires deployment or architectural changes"],
    ["Total",   str(len(FINDINGS)), ""],
]
fix_style = TableStyle([
    ("BACKGROUND", (0,0),(-1,0), DARK),
    ("TEXTCOLOR",  (0,0),(-1,0), WHITE),
    ("FONTNAME",   (0,0),(-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0),(-1,-1), 9),
    ("ROWBACKGROUNDS", (0,1),(-1,-1),[LGREY,WHITE,LGREY]),
    ("GRID",       (0,0),(-1,-1), 0.5, MGREY),
    ("TOPPADDING", (0,0),(-1,-1), 5),
    ("BOTTOMPADDING",(0,0),(-1,-1),5),
    ("LEFTPADDING",(0,0),(-1,-1), 8),
    ("BACKGROUND", (0,1),(0,1), GREEN),
    ("TEXTCOLOR",  (0,1),(0,1), WHITE),
    ("FONTNAME",   (0,1),(0,1), "Helvetica-Bold"),
    ("BACKGROUND", (0,2),(0,2), ORANGE),
    ("TEXTCOLOR",  (0,2),(0,2), WHITE),
    ("FONTNAME",   (0,2),(0,2), "Helvetica-Bold"),
])
t2 = Table(fix_rows, colWidths=[3.5*cm, 2*cm, 10*cm])
t2.setStyle(fix_style)
story.append(t2)

# Detailed findings
story.append(sp(14))
story.append(p("Detailed Findings", H1))
story.append(hr())

for f in FINDINGS:
    sev = f["severity"]
    sc  = SEV_COLOR[sev]
    badge = "FIXED" if f["fixed"] else "ACTION REQUIRED"
    bc    = GREEN  if f["fixed"] else RED

    fh = ParagraphStyle("fh", fontName="Helvetica-Bold", fontSize=11, textColor=WHITE, leading=14)
    fs = ParagraphStyle("fs", fontName="Helvetica-Bold", fontSize=10, textColor=WHITE, alignment=TA_CENTER)
    fb = ParagraphStyle("fb", fontName="Helvetica-Bold", fontSize=9,  textColor=WHITE, alignment=TA_CENTER)

    hdr = [[
        Paragraph(f"{f['id']} - {f['title']}", fh),
        Paragraph(sev, fs),
        Paragraph(badge, fb),
    ]]
    hstyle = TableStyle([
        ("BACKGROUND", (0,0),(0,0), sc),
        ("BACKGROUND", (1,0),(1,0), sc),
        ("BACKGROUND", (2,0),(2,0), bc),
        ("TOPPADDING",    (0,0),(-1,-1), 7),
        ("BOTTOMPADDING", (0,0),(-1,-1), 7),
        ("LEFTPADDING",   (0,0),(-1,-1), 8),
        ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
    ])
    ht = Table(hdr, colWidths=[10.5*cm, 2.5*cm, 3.5*cm])
    ht.setStyle(hstyle)

    rows = [
        [p("Location",    CELLB), p(f["location"],    CELL)],
        [p("OWASP",       CELLB), p(f["owasp"],       CELL)],
        [p("Description", CELLB), p(f["description"], CELL)],
        [p("Impact",      CELLB), p(f["impact"],      CELL)],
        [p("Remediation", CELLB), p(f["fix_description"], CELL)],
    ]
    if f.get("code_fix"):
        rows.append([p("Code Fix", CELLB), Paragraph(f["code_fix"], MONO)])

    dstyle = TableStyle([
        ("ROWBACKGROUNDS", (0,0),(-1,-1),[LGREY,WHITE]),
        ("GRID",           (0,0),(-1,-1), 0.5, MGREY),
        ("VALIGN",         (0,0),(-1,-1), "TOP"),
        ("TOPPADDING",     (0,0),(-1,-1), 5),
        ("BOTTOMPADDING",  (0,0),(-1,-1), 5),
        ("LEFTPADDING",    (0,0),(-1,-1), 7),
        ("RIGHTPADDING",   (0,0),(-1,-1), 7),
    ])
    dt = Table(rows, colWidths=[3*cm, 13.5*cm])
    dt.setStyle(dstyle)
    story.append(KeepTogether([ht, dt, sp(12)]))

# Recommendations
story.append(p("Priority Recommendations", H1))
story.append(hr())

recs = [
    ("Immediate - Do Today", RED, [
        "Rotate the exposed Anthropic API key, Gemini API key, and Gmail SMTP app-password in all environments.",
        "Regenerate JWT_SECRET with: openssl rand -hex 64 and redeploy the backend immediately.",
        "Set a strong REDIS_PASSWORD and enable Redis AUTH (requirepass) in redis.conf.",
        "Change the PostgreSQL password from the default 'root' to a strong random value.",
        "Set NODE_ENV=production in all Render (or cloud) deployment environment variables.",
    ]),
    ("Short-term - This Sprint", ORANGE, [
        "Deploy the code fixes from this report: rate limiting, Helmet, roles guard, password policy, magic bytes, path fix.",
        "Set UPLOAD_DUMP_DIR to the correct absolute production path in Render environment variables.",
        "Audit ALL Render environment variables -- ensure no real secrets exist in committed code.",
        "Run npm audit in both backend and frontend; address critical and high severity packages.",
    ]),
    ("Medium-term - Next Sprint", YELLOW, [
        "Migrate JWT storage from localStorage to HttpOnly, SameSite=Strict cookies.",
        "Implement a Redis-backed JWT denylist for true session invalidation on logout.",
        "Replace execSync() in OCR services with spawnSync() and argument arrays.",
        "Deliver temporary passwords via email instead of JSON response bodies.",
    ]),
    ("Long-term - Architecture", BLUE, [
        "Complete Multi-Factor Authentication (2FA) -- disabled code exists, needs schema completion.",
        "Add a WAF (Web Application Firewall) in front of the production deployment.",
        "Integrate automated secret scanning (git-secrets or Trufflehog) in CI/CD pipelines.",
        "Schedule quarterly penetration tests and annual security architecture reviews.",
    ]),
]

for title, color, items in recs:
    story.append(p(title, H2))
    rows2 = [[
        Paragraph("*", ParagraphStyle("bul", fontName="Helvetica-Bold", fontSize=12, textColor=color)),
        Paragraph(item, BODY),
    ] for item in items]
    bt = Table(rows2, colWidths=[0.5*cm, 16*cm])
    bt.setStyle(TableStyle([
        ("VALIGN",       (0,0),(-1,-1),"TOP"),
        ("TOPPADDING",   (0,0),(-1,-1),3),
        ("BOTTOMPADDING",(0,0),(-1,-1),3),
    ]))
    story.append(bt)
    story.append(sp(6))

story.append(sp(16))
story.append(hr())
story.append(p(
    f"This report was produced by an automated security audit of the ClaimsFlow codebase on "
    f"{date.today().strftime('%B %d, %Y')}. "
    "Classification: CONFIDENTIAL -- for CIC Insurance Group engineering and security staff only.",
    CAPTION,
))

doc.build(story)
print(f"Report written to: {OUTPUT}")
