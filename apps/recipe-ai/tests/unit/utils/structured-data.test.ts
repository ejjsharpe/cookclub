import { describe, expect, it } from "vitest";

import { extractStructuredRecipeCandidates } from "../../../src/import/url/structured-data";

function firstStructuredRecipe(html: string, sourceUrl: string) {
  return extractStructuredRecipeCandidates(html, sourceUrl)[0] ?? null;
}

describe("extractStructuredRecipeCandidates", () => {
  it("decodes HTML entities from structured recipe text", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Nana&#039;s Fish &amp; Chips",
              "description": "Crispy&nbsp;chips &rsquo;n caf&eacute; sauce",
              "image": "https://example.com/image.jpg?name=fish&amp;size=large",
              "recipeYield": "Serves&nbsp;4",
              "recipeCuisine": "British &amp; Irish",
              "recipeCategory": "Main&nbsp;course",
              "recipeIngredient": [
                "2&nbsp;cups potatoes",
                "1 tbsp chef&#039;s sauce"
              ],
              "recipeInstructions": [
                {
                  "@type": "HowToSection",
                  "name": "Chef&#039;s prep",
                  "itemListElement": [
                    {
                      "@type": "HowToStep",
                      "text": "Mix &amp; fry until it&#039;s crisp."
                    }
                  ]
                }
              ]
            }
          </script>
        </head>
      </html>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/recipe");

    expect(recipe).not.toBeNull();
    expect(recipe?.name).toBe("Nana's Fish & Chips");
    expect(recipe?.description).toBe("Crispy chips 'n caf\u00e9 sauce");
    expect(recipe?.servings).toBe(4);
    expect(recipe?.images).toEqual([
      "https://example.com/image.jpg?name=fish&size=large",
    ]);
    expect(recipe?.ingredientSections[0]?.ingredients[0]?.name).toBe(
      "potatoes",
    );
    expect(recipe?.ingredientSections[0]?.ingredients[1]?.name).toBe(
      "chef's sauce",
    );
    expect(recipe?.instructionSections[0]?.name).toBe("Chef's prep");
    expect(recipe?.instructionSections[0]?.instructions[0]?.instruction).toBe(
      "Mix & fry until it's crisp.",
    );
    expect(recipe?.suggestedTags).toEqual(["British & Irish", "Main course"]);
  });

  it("extracts microdata recipes", () => {
    const html = `
      <article itemscope itemtype="https://schema.org/Recipe">
        <h1 itemprop="name">Microdata Pancakes</h1>
        <meta itemprop="prepTime" content="15 minutes">
        <img itemprop="image" src="/pancakes.jpg">
        <ul>
          <li itemprop="recipeIngredient">1 cup flour</li>
          <li itemprop="recipeIngredient">2 eggs</li>
        </ul>
        <ol itemprop="recipeInstructions">
          <li>Whisk the batter.</li>
          <li>Cook in a hot pan.</li>
        </ol>
      </article>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/recipes/");

    expect(recipe?.name).toBe("Microdata Pancakes");
    expect(recipe?.prepTime).toBe(15);
    expect(recipe?.images).toEqual(["https://example.com/pancakes.jpg"]);
    expect(recipe?.ingredientSections[0]?.ingredients).toHaveLength(2);
    expect(recipe?.instructionSections[0]?.instructions).toHaveLength(2);
  });

  it("caps structured recipe images to the six best main images", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Image Heavy Pancakes",
              "image": [
                "/pancakes-225x225.jpg",
                "/pancakes-1200x800.jpg",
                "/pancakes.jpg",
                "/step-1.jpg",
                "/step-2.jpg",
                "/step-3.jpg",
                "/step-4.jpg",
                "/step-5.jpg",
                "/step-6.jpg",
                "/step-7.jpg"
              ],
              "recipeIngredient": ["1 cup flour"],
              "recipeInstructions": ["Whisk and cook."]
            }
          </script>
        </head>
      </html>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/recipe");

    expect(recipe?.images).toEqual([
      "https://example.com/pancakes.jpg",
      "https://example.com/step-1.jpg",
      "https://example.com/step-2.jpg",
      "https://example.com/step-3.jpg",
      "https://example.com/step-4.jpg",
      "https://example.com/step-5.jpg",
    ]);
  });

  it("extracts RDFa recipes", () => {
    const html = `
      <article typeof="schema:Recipe">
        <h1 property="schema:name">RDFa Pasta</h1>
        <p property="schema:description">A fast pasta dinner.</p>
        <span property="schema:recipeYield">Serves 2</span>
        <ul>
          <li property="schema:recipeIngredient">200g spaghetti</li>
          <li property="schema:recipeIngredient">1 cup tomatoes</li>
        </ul>
        <div property="schema:recipeInstructions">
          <p property="schema:text">Boil the pasta.</p>
          <p property="schema:text">Toss with sauce.</p>
        </div>
      </article>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/pasta");

    expect(recipe?.name).toBe("RDFa Pasta");
    expect(recipe?.description).toBe("A fast pasta dinner.");
    expect(recipe?.servings).toBe(2);
    expect(recipe?.instructionSections[0]?.instructions[1]?.instruction).toBe(
      "Toss with sauce.",
    );
  });

  it("extracts WP Recipe Maker cards", () => {
    const html = `
      <div class="wprm-recipe">
        <h2 class="wprm-recipe-name">Plugin Brownies</h2>
        <div class="wprm-recipe-summary">Fudgy brownies.</div>
        <span class="wprm-recipe-prep_time">20 minutes</span>
        <span class="wprm-recipe-servings">Serves 9</span>
        <div class="wprm-recipe-image"><img src="brownies.jpg"></div>
        <ul>
          <li class="wprm-recipe-ingredient">1 cup cocoa powder</li>
          <li class="wprm-recipe-ingredient">2 cups sugar</li>
        </ul>
        <div class="wprm-recipe-instruction-text">Mix the batter.</div>
        <div class="wprm-recipe-instruction-text">Bake until set.</div>
      </div>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/sweets/");

    expect(recipe?.name).toBe("Plugin Brownies");
    expect(recipe?.description).toBe("Fudgy brownies.");
    expect(recipe?.prepTime).toBe(20);
    expect(recipe?.servings).toBe(9);
    expect(recipe?.images).toEqual(["https://example.com/sweets/brownies.jpg"]);
  });

  it("extracts Tasty Recipes cards", () => {
    const html = `
      <div class="tasty-recipes">
        <h2 class="tasty-recipes-title">Tasty Soup</h2>
        <div class="tasty-recipes-yield">Yield: 4 servings</div>
        <div class="tasty-recipes-image"><img src="/soup.jpg"></div>
        <div class="tasty-recipes-ingredients">
          <ul>
            <li>4 cups stock</li>
            <li>1 cup lentils</li>
          </ul>
        </div>
        <div class="tasty-recipes-instructions">
          <ol>
            <li>Simmer everything.</li>
            <li>Season to taste.</li>
          </ol>
        </div>
      </div>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/soup");

    expect(recipe?.name).toBe("Tasty Soup");
    expect(recipe?.servings).toBe(4);
    expect(recipe?.images).toEqual(["https://example.com/soup.jpg"]);
    expect(recipe?.ingredientSections[0]?.ingredients[1]?.name).toBe("lentils");
  });

  it("prefers JSON-LD over a conflicting generic recipe card", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          "name": "Sausage, kale & gnocchi one-pot",
          "recipeIngredient": ["6 pork sausages", "500g gnocchi"],
          "recipeInstructions": [
            { "@type": "HowToStep", "text": "Brown the sausages." },
            { "@type": "HowToStep", "text": "Cook the gnocchi and kale." }
          ]
        }
      </script>
      <div class="recipe-card">
        <h2>Ingredients</h2>
        <div class="ingredients">
          <ul>
            <li>6 pork sausages</li>
            <li>500g gnocchi</li>
            <li>kcal516</li>
            <li>fat27g</li>
          </ul>
        </div>
        <div class="instructions">
          <ol>
            <li>6 pork sausages</li>
            <li>500g gnocchi</li>
            <li>Brown the sausages.</li>
            <li>Cook the gnocchi and kale.</li>
          </ol>
        </div>
      </div>
    `;

    const recipes = extractStructuredRecipeCandidates(
      html,
      "https://www.bbcgoodfood.com/recipes/sausage-kale-gnocchi-one-pot",
    );

    expect(recipes).toHaveLength(1);
    expect(recipes[0]?.name).toBe("Sausage, kale & gnocchi one-pot");
    expect(recipes[0]?.ingredientSections[0]?.ingredients).toHaveLength(2);
    expect(recipes[0]?.instructionSections[0]?.instructions).toHaveLength(2);
  });

  it("does not treat a page-level .recipe wrapper as a plugin card", () => {
    const html = `
      <div class="post recipe">
        <h2>Ingredients</h2>
        <div class="ingredients">
          <ul><li>1 cup flour</li><li>2 eggs</li></ul>
        </div>
        <div class="instructions">
          <ol><li>Mix the batter.</li><li>Bake until set.</li></ol>
        </div>
      </div>
    `;

    expect(
      extractStructuredRecipeCandidates(
        html,
        "https://example.com/not-a-recipe-card",
      ),
    ).toEqual([]);
  });

  it("extracts recipes nested in hydration JSON", () => {
    const hydration = {
      props: {
        pageProps: {
          recipe: {
            "@type": "Recipe",
            name: "Next Data Cake",
            image: "/cake.jpg",
            recipeIngredient: ["1 cup flour", "1 cup sugar"],
            recipeInstructions: [
              { "@type": "HowToStep", text: "Mix the cake batter." },
              { "@type": "HowToStep", text: "Bake until risen." },
            ],
          },
        },
      },
    };
    const html = `
      <script id="__NEXT_DATA__" type="application/json">
        ${JSON.stringify(hydration)}
      </script>
    `;

    const recipe = firstStructuredRecipe(html, "https://example.com/cake");

    expect(recipe?.name).toBe("Next Data Cake");
    expect(recipe?.images).toEqual(["https://example.com/cake.jpg"]);
    expect(recipe?.instructionSections[0]?.instructions[0]?.instruction).toBe(
      "Mix the cake batter.",
    );
  });
});
