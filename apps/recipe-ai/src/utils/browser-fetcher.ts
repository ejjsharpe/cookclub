import puppeteer from "@cloudflare/puppeteer";

import { validateFetchUrl } from "./html-fetcher";

const BROWSER_REQUIRED_DOMAINS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "pin.it",
  "threads.net",
  "x.com",
  "twitter.com",
  "reddit.com",
];

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
  browser: Fetcher,
  url: string,
): Promise<string> {
  validateFetchUrl(url);
  const instance = await puppeteer.launch(browser);

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

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    try {
      const closeButton = await page.$('[aria-label="Close"]');
      if (closeButton) {
        await closeButton.click();
      }
    } catch {
      // Ignore popup dismissal errors.
    }

    return await page.content();
  } finally {
    await instance.close();
  }
}
