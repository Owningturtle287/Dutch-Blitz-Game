# Overcurrent

Overcurrent is a mobile-first, real-time card race for one player and up to three computer rivals. Play all 24 cards before the others do. The table starts with three shared piles.

| Pile | Rule |
| --- | --- |
| Rise | Play one number higher. After 6 comes 1. |
| Match | Play the same symbol. Any number works. |
| Fall | Play one number lower. After 1 comes 6. |

Tap a highlighted card to play it. If it fits in several places, choose a pile. A 1 can start a new pile, and the game sets no pile limit. New piles cycle through Rise, Match, and Fall. Swipe the row or use the arrows to browse. Swap a card when your hand gets stuck. The tops of the piles reset when nobody can play.

## Play and install

The [GitHub Pages site](https://owningturtle287.github.io/Dutch-Blitz-Game/) is published by the [Pages workflow](../../actions/workflows/pages.yml). For an initial setup, select **GitHub Actions** under **Settings → Pages → Build and deployment** and run the workflow. Pushes to `main` deploy automatically after setup.

On iPhone or iPad, open the site in Safari and tap **Share → Add to Home Screen**. On Android, use Chrome’s **Install app** or **Add to Home Screen** option. Once the first visit has finished loading, you can play offline.

## Develop

Serve `public` with any local web server, for example `python3 -m http.server 8000 --directory public`. Run the engine checks with `node --test`.

Suit pictograms come from [Lucide](https://lucide.dev/) under the [ISC license](public/assets/LUCIDE-LICENSE.txt).
