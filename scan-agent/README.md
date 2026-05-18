# ClaimsFlow Local Scan Agent

A lightweight local service that bridges your physical scanner (TWAIN / SANE / WIA / ISIS) to the ClaimsFlow web UI — including the cloud-hosted deployment on Render.

## How it works

```
ClaimsFlow web UI (browser)
        │
        │  http://localhost:7420
        ▼
ClaimsFlow Scan Agent  ◄──── runs on your computer
        │
        │  WIA / SANE / ISIS
        ▼
   Physical Scanner
```

The agent runs entirely on your machine and only listens on `127.0.0.1` (localhost) — it is never exposed to the internet.

---

## Quick start

### Prerequisites

| Platform | Scanner driver needed |
|---|---|
| Windows | WIA driver for your scanner (installed automatically by Windows Update or your scanner's setup disc). Covers all TWAIN and ISIS devices that ship a WIA driver (Epson, HP, Canon, Fujitsu, Kodak Alaris, etc.). |
| Linux | `sudo apt install sane-utils` (Debian/Ubuntu) or `sudo dnf install sane-backends` (Fedora) |
| macOS | SANE via Homebrew: `brew install sane-backends` |

Node.js 18 or later must be installed: <https://nodejs.org>

### Install and run

```bash
# From the repo root
cd scan-agent
npm install
npm start
```

The agent starts on `http://127.0.0.1:7420`. Leave this terminal open while scanning.

---

## Custom port

```bash
SCAN_AGENT_PORT=7421 npm start
```

---

## Scanner compatibility

| Interface | Windows | Linux | macOS |
|---|---|---|---|
| TWAIN (via WIA) | ✅ | — | — |
| WIA 1.0 | ✅ | — | — |
| ISIS (via WIA driver) | ✅ | — | — |
| SANE | — | ✅ | ✅ |
| Network scanners (Epson, HP, Canon) | ✅ WIA | ✅ SANE | ✅ SANE |

> **ISIS note:** Kodak Alaris, Panasonic, and other ISIS scanners expose their features through WIA on Windows and SANE on Linux. The agent uses these standard interfaces, so all ISIS-certified scanners with current drivers are supported.

---

## Security

- Binds to `127.0.0.1` only — unreachable from other machines on the network.
- CORS is restricted to `claimsflow-frontend.onrender.com` and localhost origins.
- Device IDs are validated against the live discovered device list before any scan is executed — no shell injection possible.

---

## Stopping the agent

Press `Ctrl+C` in the terminal where it is running.
