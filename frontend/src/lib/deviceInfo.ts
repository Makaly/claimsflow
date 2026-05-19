/**
 * Browser-side device classification for scan metering.
 *
 * Returns the OS + a coarse "deviceClass" (desktop | mobile | camera) so the
 * cloud dashboard can break down scans by channel — physical scanner on a
 * desktop, phone camera, laptop webcam, etc. We do not do detailed
 * fingerprinting; just enough to populate the audit log.
 */

export type DeviceClass = 'desktop' | 'mobile' | 'camera';

export interface DeviceInfo {
  /** Coarse channel. Caller can override with 'camera' for the camera-scan path. */
  deviceClass: Exclude<DeviceClass, 'camera'>;
  /** Normalized OS name. */
  os: 'linux' | 'windows' | 'darwin' | 'android' | 'ios' | 'web';
  /** Raw user-agent string — server already has it via headers but we send it
   *  to make the event log self-contained. */
  userAgent: string;
}

interface UAData {
  platform?: string;
  mobile?: boolean;
}

function getUAData(): UAData | null {
  // navigator.userAgentData is the modern Chromium/Edge API; Safari/Firefox
  // still lack it. We fall back to UA string sniffing when absent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (navigator as any).userAgentData as UAData | undefined;
  return data ?? null;
}

export function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent || '';
  const uaData = getUAData();
  const platform = (uaData?.platform || navigator.platform || '').toLowerCase();

  // OS detection — prefer modern UA-CH platform, fall back to UA string.
  let os: DeviceInfo['os'] = 'web';
  if (/android/i.test(ua) || platform === 'android') os = 'android';
  else if (/iphone|ipad|ipod/i.test(ua) || platform === 'ios') os = 'ios';
  else if (/windows/i.test(ua) || platform.includes('win')) os = 'windows';
  else if (/mac/i.test(ua) || platform.includes('mac')) os = 'darwin';
  else if (/linux/i.test(ua) || platform.includes('linux')) os = 'linux';

  const isMobile =
    uaData?.mobile === true ||
    os === 'android' ||
    os === 'ios' ||
    /mobi|tablet/i.test(ua);

  return {
    deviceClass: isMobile ? 'mobile' : 'desktop',
    os,
    userAgent: ua,
  };
}
