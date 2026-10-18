import puppeteer from "@cloudflare/puppeteer";
import { PINTEREST_IMPORT_HOSTS } from "@repo/contracts/recipe-import";

import { validateFetchUrl } from "./fetch";

const BROWSER_REQUIRED_DOMAINS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.com",
  "youtube.com",
  "youtu.be",
  ...PINTEREST_IMPORT_HOSTS,
  "threads.net",
  "x.com",
  "twitter.com",
];
const MAX_BROWSER_HTML_BYTES = 2 * 1024 * 1024;

export function requiresBrowserRendering(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return BROWSER_REQUIRED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

export async function fetchHtmlWithBrowser(
  browser: BrowserRun,
  url: string,
): Promise<string> {
  validateFetchUrl(url);
  // Wrangler's generated binding name is newer than the puppeteer package's
  // BrowserWorker alias, but both describe the same browser binding.
  const instance = await puppeteer.launch(
    browser as unknown as Parameters<typeof puppeteer.launch>[0],
  );

  try {
    const page = await instance.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );

    await page.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
    });

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        validateFetchUrl(request.url());
        request.continue().catch(() => undefined);
      } catch {
        request.abort("blockedbyclient").catch(() => undefined);
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    validateFetchUrl(page.url());

    try {
      const closeButton = await page.$('[aria-label="Close"]');
      if (closeButton) {
        await closeButton.click();
      }
    } catch {
      // Ignore popup dismissal errors.
    }

    const html = await page.content();
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (byteLength > MAX_BROWSER_HTML_BYTES) {
      throw new Error(`HTML response too large: ${byteLength} bytes`);
    }
    return html;
  } finally {
    await instance.close();
  }
}
