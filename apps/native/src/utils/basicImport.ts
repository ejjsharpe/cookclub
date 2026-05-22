const BASIC_IMPORT_UNSUPPORTED_DOMAINS = [
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "facebook.com",
  "www.facebook.com",
  "fb.com",
  "www.fb.com",
];

export function isBasicImportUnsupportedUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return BASIC_IMPORT_UNSUPPORTED_DOMAINS.some(
      (domain) =>
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}
