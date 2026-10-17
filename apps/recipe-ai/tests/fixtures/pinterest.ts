import batCupcakes from "./pinterest/1970393584792970.json";
import chiliRoundup from "./pinterest/1970393584793065.json";
import enchiladaPie from "./pinterest/1970393584793163.json";
import butterCake from "./pinterest/1970393584793223.json";
import tartarSauce from "./pinterest/1970393584793314.json";
import pecanPie from "./pinterest/1970393584794073.json";

export const recipePins = [
  pecanPie,
  tartarSauce,
  butterCake,
  enchiladaPie,
  batCupcakes,
];
export { chiliRoundup };

export function pinterestHtml(fixture: {
  meta?: Record<string, string>;
  structured?: unknown[];
  payload?: unknown;
}): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  const json = (value: unknown) =>
    JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<html><head>${Object.entries(fixture.meta ?? {})
    .map(
      ([key, value]) =>
        `<meta property="${escape(key)}" content="${escape(value)}">`,
    )
    .join(
      "",
    )}</head><body>${(fixture.structured ?? []).map((data) => `<script type="application/ld+json">${json(data)}</script>`).join("")}<script type="application/json">${json(fixture.payload ?? {})}</script></body></html>`;
}
