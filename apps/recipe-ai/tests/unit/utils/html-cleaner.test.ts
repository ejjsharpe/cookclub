import { describe, it, expect } from "vitest";

import {
  cleanHtml,
  extractImageUrls,
  extractText,
  focusRecipeContent,
} from "../../../src/utils/html-cleaner";

describe("cleanHtml", () => {
  describe("noise removal", () => {
    it("removes script tags", () => {
      const html = `
        <html>
          <body>
            <p>Recipe content</p>
            <script>console.log('evil');</script>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("console.log");
      expect(result).not.toContain("evil");
    });

    it("removes style tags", () => {
      const html = `
        <html>
          <body>
            <p>Recipe content</p>
            <style>.recipe { color: red; }</style>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("color: red");
    });

    it("removes navigation elements", () => {
      const html = `
        <html>
          <body>
            <nav>Home | About | Contact</nav>
            <p>Recipe content</p>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("Home | About | Contact");
    });

    it("removes header and footer", () => {
      const html = `
        <html>
          <body>
            <header>Site Header</header>
            <p>Recipe content</p>
            <footer>Copyright 2024</footer>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("Site Header");
      expect(result).not.toContain("Copyright 2024");
    });

    it("removes elements with ads class", () => {
      const html = `
        <html>
          <body>
            <div class="ads">Buy our stuff!</div>
            <p>Recipe content</p>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("Buy our stuff");
    });

    it("removes elements with advertisement in class", () => {
      const html = `
        <html>
          <body>
            <div class="advertisement-banner">Sponsored</div>
            <p>Recipe content</p>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("Sponsored");
    });

    it("removes comments section", () => {
      const html = `
        <html>
          <body>
            <p>Recipe content</p>
            <div class="comments">User said: Great recipe!</div>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Recipe content");
      expect(result).not.toContain("User said");
    });
  });

  describe("main content extraction", () => {
    it("prefers article tag content", () => {
      const html = `
        <html>
          <body>
            <div>Sidebar stuff</div>
            <article>Main recipe content here</article>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Main recipe content here");
    });

    it("prefers main tag content", () => {
      const html = `
        <html>
          <body>
            <aside>Sidebar</aside>
            <main>Main recipe content</main>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Main recipe content");
    });

    it("falls back to body if no main content area", () => {
      const html = `
        <html>
          <body>
            <div>Body content</div>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).toContain("Body content");
    });
  });

  describe("whitespace handling", () => {
    it("collapses multiple whitespaces", () => {
      const html = `
        <html>
          <body>
            <p>Word1     Word2</p>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).not.toContain("     ");
      expect(result).toContain("Word1 Word2");
    });

    it("trims leading and trailing whitespace", () => {
      const html = `
        <html>
          <body>
            <p>  Content  </p>
          </body>
        </html>
      `;
      const result = cleanHtml(html);
      expect(result).not.toMatch(/^\s/);
      expect(result).not.toMatch(/\s$/);
    });
  });

  describe("length limiting", () => {
    it("truncates very long content to 15000 characters", () => {
      const longContent = "A".repeat(20000);
      const html = `<html><body><p>${longContent}</p></body></html>`;
      const result = cleanHtml(html);
      expect(result.length).toBeLessThanOrEqual(15000);
    });
  });
});

describe("extractText", () => {
  it("extracts all text without aggressive cleaning", () => {
    const html = `
      <html>
        <body>
          <nav>Navigation</nav>
          <p>Main content</p>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    const result = extractText(html);
    expect(result).toContain("Navigation");
    expect(result).toContain("Main content");
    expect(result).toContain("Footer");
  });

  it("still removes script and style tags", () => {
    const html = `
      <html>
        <body>
          <script>alert('bad');</script>
          <style>.x { color: red; }</style>
          <p>Content</p>
        </body>
      </html>
    `;
    const result = extractText(html);
    expect(result).toContain("Content");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("color");
  });
});

describe("focusRecipeContent", () => {
  it("keeps the real recipe card when ingredients appear late in the page", () => {
    const intro = "Story ".repeat(4000);
    const text = `${intro} Key Ingredients Pecans and honey are useful. Recipe Ingredients 1 cup flour 2 eggs Instructions Mix everything. Bake until done.`;

    const focused = focusRecipeContent(text, 500);

    expect(focused).toContain("Recipe Ingredients");
    expect(focused).toContain("Instructions Mix everything");
    expect(focused.length).toBeLessThanOrEqual(500);
  });
});

describe("extractImageUrls", () => {
  it("uses social meta images and the largest srcset candidate", () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="/hero.jpg">
          <meta name="twitter:image" content="/twitter.jpg">
        </head>
        <body>
          <article>
            <img
              src="/small.jpg"
              srcset="/small.jpg 320w, /large.jpg 1200w"
              width="1200"
              height="800"
            >
          </article>
        </body>
      </html>
    `;

    const images = extractImageUrls(html, "https://example.com/recipe");

    expect(images).toEqual([
      "https://example.com/hero.jpg",
      "https://example.com/twitter.jpg",
      "https://example.com/large.jpg",
    ]);
  });

  it("caps images at 6 and prefers recipe-specific images", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Chocolate Chip Cookies",
              "image": [
                "/schema-225x225.jpg",
                "/schema-260x195.jpg",
                "/schema.jpg"
              ]
            }
          </script>
          <meta property="og:image" content="/hero.jpg">
          <meta name="twitter:image" content="/twitter.jpg">
        </head>
        <body>
          <article>
            <div class="author"><img src="/headshot.jpg" alt="author headshot"></div>
            <div class="recipe-card"><img src="/card.jpg" width="1200" height="800"></div>
            <img src="/step-1.jpg" width="1200" height="800">
            <img src="/step-2.jpg" width="1200" height="800">
            <img src="/step-3.jpg" width="1200" height="800">
            <img src="/step-4.jpg" width="1200" height="800">
            <img src="/step-5.jpg" width="1200" height="800">
            <img src="/step-6.jpg" width="1200" height="800">
            <img src="/step-7.jpg" width="1200" height="800">
            <img src="/step-8.jpg" width="1200" height="800">
            <div class="related-posts"><img src="/other-recipe.jpg"></div>
          </article>
        </body>
      </html>
    `;

    const images = extractImageUrls(html, "https://example.com/recipe");

    expect(images).toEqual([
      "https://example.com/schema.jpg",
      "https://example.com/hero.jpg",
      "https://example.com/twitter.jpg",
      "https://example.com/card.jpg",
      "https://example.com/step-1.jpg",
      "https://example.com/step-2.jpg",
    ]);
  });
});
