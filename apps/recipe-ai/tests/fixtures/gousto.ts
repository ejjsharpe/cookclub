// Reduced response matching Gousto's public cookbook API. Instructions are
// abbreviated; labels, serving variants and HTML follow the reported recipe.
export const goustoUrl =
  "https://www.gousto.co.uk/cookbook/recipes/pork-beef-ragu-with-fresh-tagliatelle-nduja-dough-balls";

export const goustoApiUrl =
  "https://production-api.gousto.co.uk/cmsreadbroker/v1/recipe/pork-beef-ragu-with-fresh-tagliatelle-nduja-dough-balls";

export const goustoShell = `<!doctype html><html><head>
  <title>Recipes | Quick and Easy Dinner Ideas | Gousto</title>
  <script defer src="/cookbook/static/js/main.207699cf.js"></script>
  </head><body><noscript>You need to enable JavaScript to run this app.</noscript>
  <div id="root"></div></body></html>`;

export const goustoResponse = {
  status: "ok",
  data: {
    entry: {
      url: "/pork-beef-ragu-with-fresh-tagliatelle-nduja-dough-balls",
      title:
        "Pork & Beef Red Wine Ragù With Fresh Tagliatelle & 'Nduja Dough Balls",
      description: "Fresh tagliatelle with a slow-cooked pork and beef ragù.",
      prep_times: { for_2: 50, for_4: 55 },
      cuisine: { title: "Italian" },
      media: {
        images: [
          {
            image: "https://production-media.gousto.co.uk/ragu-x200.jpg",
            width: 200,
          },
          {
            image: "https://production-media.gousto.co.uk/ragu-x1500.jpg",
            width: 1500,
          },
        ],
      },
      ingredients: [
        { label: "Pork & beef mince (250g)" },
        { label: "Pork & beef mince (125g) x0" },
        { label: "Fresh tagliatelle (250g)" },
        { label: "Intense beef stock mix (5.5g)" },
        { label: "Garlic clove x3" },
        { label: "Dried bay leaf" },
        { label: "Balsamic vinegar (15ml)" },
      ],
      basics: [{ title: "Butter" }, { title: "Flour" }, { title: "Water" }],
      cooking_instructions: [
        {
          order: 1,
          instruction:
            '<p>Mix the yeast with 100ml<span class="text-purple"> [150ml]</span> <span class="text-danger">[200ml]</span> <strong>warm water</strong>.</p><p>Set aside for 5 minutes.</p>',
          media: {
            images: [
              {
                image: "https://production-media.gousto.co.uk/step-1-x700.jpg",
                width: 700,
              },
            ],
          },
        },
        {
          order: 2,
          instruction:
            "<p>Brown the mince &amp; garlic, then simmer the sauce.</p>",
          media: { images: [] },
        },
      ],
      nutritional_information: {
        per_hundred_grams: { energy_kcal: 235 },
        per_portion: {
          energy_kcal: 1319,
          protein_mg: 60545,
          carbs_mg: 177074,
          fat_mg: 43201,
          fat_saturates_mg: 16407,
          fibre_mg: 9709,
          carbs_sugars_mg: 10439,
        },
      },
    },
  },
};
