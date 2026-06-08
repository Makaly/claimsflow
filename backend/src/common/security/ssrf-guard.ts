import { BadRequestException } from '@nestjs/common';
import * as net from 'net';

/**
 * SSRF guard for outbound requests whose URL is influenced by configuration or
 * user input (e.g. admin-configured "REST API" lookup sources). It blocks the
 * classic SSRF targets — loopback, RFC1918/unique-local, link-local, and the
 * cloud metadata endpoint (169.254.169.254) — and rejects non-HTTP(S) schemes.
 *
 * Note: this checks the URL's literal host. A hostname that resolves to a
 * private IP via DNS (DNS-rebinding) is a residual risk; for full protection,
 * resolve and re-check at connect time or run egress behind an allowlist proxy.
 */
function isBlockedIp(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (net.isIPv4(h)) {
    const o = h.split('.').map(Number);
    return (
      o[0] === 127 ||                                   // loopback
      o[0] === 10 ||                                    // 10/8
      (o[0] === 192 && o[1] === 168) ||                 // 192.168/16
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||     // 172.16/12
      (o[0] === 169 && o[1] === 254) ||                 // link-local + metadata
      o[0] === 0                                        // 0.0.0.0/8
    );
  }
  if (net.isIPv6(h)) {
    return h === '::1' || h.startsWith('fd') || h.startsWith('fc') || h.startsWith('fe80') || h === '::';
  }
  return false;
}

export function assertSafeOutboundUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Invalid outbound URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http(s) outbound URLs are allowed');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    throw new BadRequestException('Refusing to call a loopback/metadata host');
  }
  if (isBlockedIp(host)) {
    throw new BadRequestException('Refusing to call a private/link-local/metadata address');
  }
}
