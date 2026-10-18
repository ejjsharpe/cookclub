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

The `1085719422756328161.json` fixture captures selected public metadata from
the reported [Marry Me Chicken Pasta share](https://pin.it/6yNaaUV80) on
2026-10-18. Its redirect chain passes through `pinterest.co.uk` and `/sent/`.
The saved pin's Relay data identifies its original pin, `18436679720775782`,
which supplies the page's canonical metadata. Only the selected pin's recipe
fields and canonical relationship are retained; account data and share invite
parameters are omitted. Tests also cover deferred Relay data carrying only the
canonical SEO path. The fixed importer was run against the live short URL and
its linked Domestic Spoon page, returning Marry Me Chicken Pasta via Schema.org
with 22 ingredient entries and 12 instructions. Image upload and device UI were
not part of that live check.

Linked-page HTML and AI responses in the import tests use explicitly synthetic
recipe data. Other embedded-state, short-link and failure cases are synthetic.
Tests verify routing, isolation, attribution, image staging and failure handling;
they do not establish recipe accuracy, device share-sheet behavior or live
availability. Direct Allrecipes requests returned HTTP 403 in the development
environment, and the existing reader fallback returned HTTP 451, so a live
end-to-end Allrecipes import could not be verified here.
