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

## Install — one step per platform

### Windows

**Option A — graphical installer.** Download and run **[ClaimsFlow-Scan-Agent-Setup.exe](https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/ClaimsFlow-Scan-Agent-Setup.exe)**.

**Option B — PowerShell one-liner** (run an *Administrator* PowerShell):

```powershell
irm https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.ps1 | iex
```

Both install identically: the agent binary lands in `C:\Program Files\ClaimsFlow Scan Agent\`, a Windows service named `ClaimsFlowScanAgent` is registered and started, and an entry is added to **Apps & features** so users can uninstall normally. Supports TWAIN / WIA / ISIS / Epson / HP / Canon / Kodak Alaris and network scanners. Auto-starts on boot.

PowerShell flags:

| Flag / env var | Effect |
|---|---|
| `-AutoStart` / `-NoAutoStart` | Force service register on/off (skip the prompt) |
| `-Silent` | Don't prompt; use defaults (service on) |
| `-Version <tag>` or `$env:CLAIMSFLOW_VERSION` | Release tag (default `scan-agent-latest`) |
| `-InstallDir <path>` or `$env:CLAIMSFLOW_INSTALL_DIR` | Install path |

### Linux

```bash
curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh -o claimsflow-install.sh
bash claimsflow-install.sh
```

The installer:

- Downloads a prebuilt single-file binary (no Node.js install required) to `~/.local/bin/claimsflow-scan-agent`
- Optionally installs SANE backends via `apt` / `dnf` / `pacman` / `zypper`
- Optionally registers a **systemd user service** so the agent auto-starts on login and survives reboots

### macOS

```bash
curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh -o claimsflow-install.sh
bash claimsflow-install.sh
```

Same installer — registers a **launchd agent** at `~/Library/LaunchAgents/com.claimsflow.scan-agent.plist`, optionally `brew install sane-backends`.

### Quick one-liner (non-interactive)

If you don't want prompts, pipe directly — the installer auto-starts the service and skips SANE install by default in piped mode:

```bash
curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh | bash
```

Override via env vars:

| Variable | Effect |
|---|---|
| `CLAIMSFLOW_AUTOSTART=1` / `0` | Register service / install binary only |
| `CLAIMSFLOW_INSTALL_SANE=1` / `0` | Install SANE backends / skip |
| `CLAIMSFLOW_VERSION=tag` | Release tag (default `scan-agent-latest`) |
| `CLAIMSFLOW_PREFIX=path` | Install prefix (default `~/.local`) |

---

## After install

1. Open ClaimsFlow in your browser.
2. Go to the **Scan Document** tab.
3. Click **Refresh** — your scanner appears in the list.

The agent listens on `http://127.0.0.1:7420` (localhost only).

---

## Manage the service

### Linux (systemd)

```bash
systemctl --user status  claimsflow-scan-agent
systemctl --user restart claimsflow-scan-agent
systemctl --user stop    claimsflow-scan-agent
journalctl --user -u     claimsflow-scan-agent -f
```

### macOS (launchd)

```bash
launchctl list | grep claimsflow
launchctl unload ~/Library/LaunchAgents/com.claimsflow.scan-agent.plist
launchctl load   ~/Library/LaunchAgents/com.claimsflow.scan-agent.plist
tail -f ~/Library/Logs/claimsflow-scan-agent.log
```

### Windows

```
services.msc → ClaimsFlow Scan Agent
```

---

## Uninstall

### Linux / macOS

```bash
curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/uninstall.sh | bash
```

### Windows

Use **Apps & features** → *ClaimsFlow Scan Agent* → **Uninstall**, or run the bundled script:

```powershell
& "$env:ProgramFiles\ClaimsFlow Scan Agent\uninstall.ps1"
```

---

## Run from source (developers)

```bash
cd scan-agent
npm install
npm start          # http://127.0.0.1:7420
```

Build standalone binaries:

```bash
./build-unix.sh                    # current host platform
TARGETS="linux mac" ./build-unix.sh
.\build-windows.ps1                # on Windows, in PowerShell
```

---

## Custom port

```bash
SCAN_AGENT_PORT=7421 claimsflow-scan-agent
```

Or edit the systemd unit / launchd plist / Windows service config and restart the service.

---

## Scan options

The `/scan` endpoint accepts the following parameters (query string or JSON body):

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `deviceId` | scanner ID | — | required; validated against live device list |
| `resolution` | `75`, `150`, `200`, `300`, `600`, `1200` | `300` | dpi |
| `mode` | `Color`, `Gray`, `Lineart` | `Color` | |
| `source` | `auto`, `flatbed`, `feeder`, `feeder-duplex` | `auto` | ADF batch on Linux/macOS; WIA source on Windows |
| `paperSize` | `auto`, `a4`, `a5`, `letter`, `legal` | `auto` (A4) | PDF canvas size |
| `skipBlank` | `true` / `false` | `false` | discard blank pages in ADF batch scans |

### ADF / document feeder

When `source=feeder` or `source=feeder-duplex` is set on Linux/macOS, `scanimage --batch` collects all pages from the feeder in a single pass and returns a multi-page PDF. On Windows, the WIA document-handling property is set appropriately.

### Blank page detection

With `skipBlank=true`, each page's PNG IDAT payload size is compared against its pixel dimensions. Pages whose compressed data falls below 0.4 bytes/pixel are discarded as blank. Single-page scans with `skipBlank=true` return an error if the page is blank rather than silently returning an empty PDF.

### Scanner capabilities

```
GET http://127.0.0.1:7420/scanner/capabilities?deviceId=<id>
```

Returns:

```json
{
  "sources": ["flatbed", "feeder", "feeder-duplex"],
  "duplex": true
}
```

For eSCL devices, capabilities are parsed from the `ScannerCapabilities` XML; for SANE devices, `scanimage --help` is queried; other scanners default to all sources.

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

## Linux / macOS — SANE performance

The agent ships a curated `sane.d/` directory alongside `agent.js`. On Linux and macOS it sets `SANE_CONFIG_DIR` to this directory before invoking `scanimage`, bypassing the system `/etc/sane.d/dll.conf` which typically enables 40+ backends. Those backends probe USB, SNMP, and WSD on **every** `scanimage -L` call, inflating device-list time to ~9 seconds on networks with many Bonjour devices.

The bundled config enables only three backends:

| Backend | What it covers |
|---|---|
| `airscan` | eSCL + WSD network scanners — RICOH, Canon, HP, Epson, Brother, and any Mopria-compliant device |
| `kds_i2000` | Kodak Alaris i2000-series USB document scanners |
| `kodakaio` | Kodak consumer and AIO inkjet scanners (USB + SNMP network) |

This reduces device-listing latency to under 1 second. Windows is unaffected (it uses WIA/TWAIN, not SANE).

To add a backend not in this list, append its name to `sane.d/dll.conf` and place the matching `<backend>.conf` in the same directory.

---

## Security

- Binds to `127.0.0.1` only — unreachable from other machines on the network.
- CORS is restricted to `claimsflow-frontend.onrender.com` and localhost origins. Chrome's Private Network Access (PNA) preflight is handled by an explicit `OPTIONS` handler that emits `Access-Control-Allow-Private-Network: true` before `cors()` processes the request, ensuring HTTPS-hosted frontends can reach the local agent without silent browser blocks.
- Device IDs are validated against the live discovered device list before any scan is executed — no shell injection possible. For AirScan / eSCL devices, whose `airscan:wN:` index is non-deterministic across `scanimage -L` runs, validation falls back to a name-suffix match and resolves the request to the current live ID.
- The device list is cached in memory for 5 minutes (`DEVICE_CACHE_TTL_MS`) to avoid triggering slow mDNS discovery on every scan request.
- The Linux/macOS installer downloads from `https://github.com/Makaly/claimsflow/releases/...` over TLS. Inspect the script before running by saving it to disk first (`curl -o`) rather than piping straight to `bash`.
