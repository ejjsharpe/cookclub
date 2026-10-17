# Facebook regression sources

These fixtures contain selected, sanitized public embedded-data records:

- `973273425043117`: Crowded Kitchen, Homemade Wheat Thins. Public recipe subtitles.
- `1789858525376832`: Dr. Vegan, Accordion potatoes. Audio rendition, no subtitle track.
- `share/r/1GNKTPHWS9/` → `2504345230068876`: albinasveganfood, Creamy Tomato Soup & Vegan Grilled Cheese. Full story caption, truncated preview description, unrelated music subtitles.

Runtime configuration, unrelated posts, tracking data and signed media URLs were
removed. Media URLs point to inert fixture paths. The soup's song lyrics are
replaced with music markers; its recipe caption and the wheat recipe's subtitles
are retained. Tests exercise the original nesting of the selected records.

AI recipe responses in `../facebook.ts` are mocked responses derived from the
source evidence. Potato audio tests use synthetic narration and music-only
transcripts; they do not establish that the live reel yields a usable recipe.

Tests never contact Facebook or an AI provider. They verify extraction and import
handling, not live availability, model accuracy or device share sheets.
