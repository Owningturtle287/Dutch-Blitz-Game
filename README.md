# Overcurrent

Overcurrent is a landscape, real-time card race for one player and up to three computer rivals. Each racer starts with four cards in hand and 36 in their deck. The first racer to play all 40 cards wins. Decks have ranks 1–10 in yellow, blue, red, and green and a tool on each card back.

| Pile | Rule |
| --- | --- |
| Rise | Play one number higher in any color. After 10 comes 1. |
| Match | Play the same color. Any number works. |
| Fall | Play one number lower in any color. After 1 comes 10. |

You sit on the right. All shared piles stay visible in the middle of the table. Tap a highlighted card, then choose a pile if it fits in several places. You can also drag a card to its destination. Each play draws a replacement while your deck has cards. The table starts with one Rise, Match, and Fall pile. Play a 1 to open another pile, cycling through the same three rules.

Swap card puts a hand card on the bottom of your deck and draws the next one. When nobody can play, the pile tops reset and each pile keeps its rule.

## Play and install

The [GitHub Pages site](https://owningturtle287.github.io/Dutch-Blitz-Game/) is published by the [Pages workflow](../../actions/workflows/pages.yml). For an initial setup, select **GitHub Actions** under **Settings → Pages → Build and deployment** and run the workflow. Pushes to `main` deploy automatically after setup.

On iPhone or iPad, open the site in Safari and tap **Share → Add to Home Screen**. On Android, use Chrome’s **Install app** or **Add to Home Screen** option. Once the first visit has finished loading, you can play offline.

## Develop

Serve `public` with any local web server, for example `python3 -m http.server 8000 --directory public`. Run the engine checks with `node --test`.

Suit pictograms come from [Lucide](https://lucide.dev/) under the [ISC license](public/assets/LUCIDE-LICENSE.txt).
