# Pinterest regression sources

Selected public metadata captured from the Allrecipes Pinterest profile on
2026-10-17:

- [Pecan Pie](https://uk.pinterest.com/pin/1970393584794073/) (video pin linking to Southern Pecan Pie).
- [Spicy Tartar Sauce](https://uk.pinterest.com/pin/1970393584793314/).
- [Almond Croissant Ooey Gooey Butter Cake](https://uk.pinterest.com/pin/1970393584793223/).
- [Spicy Beef and Bean Enchilada Pie](https://uk.pinterest.com/pin/1970393584793163/).
- [Bat Cupcakes](https://uk.pinterest.com/pin/1970393584792970/).
- [A comparison of five chili recipes](https://uk.pinterest.com/pin/1970393584793065/), rather than a single recipe.

The new reader was also run against all six live pin URLs. Each returned its
expected original-page link and one cover image.

The JSON fixtures retain the pin's Open Graph/source metadata and selected
SocialMediaPosting data. Runtime configuration, author records, counters,
recommendations and video payloads were removed. Tracking parameters remain in
source URLs to exercise normalization. The importer follows the original recipe
page for both image and video pins; it can also parse written pin descriptions
with recipe evidence. It does not transcribe Pinterest videos or read image-only
recipe cards.

Linked-page HTML and AI responses in the import tests use explicitly synthetic
recipe data. Embedded-state, short-link and failure cases are synthetic too.
Tests verify routing, isolation, attribution, image staging and failure handling;
they do not establish recipe accuracy, device share-sheet behavior or live
availability. Direct Allrecipes requests returned HTTP 403 in the development
environment, and the existing reader fallback returned HTTP 451, so a live
end-to-end import could not be verified here.
