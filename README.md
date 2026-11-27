# Overcurrent

Overcurrent is a landscape, real-time card race for one player and up to three computer rivals. Each racer starts with a different 40-card tool deck, arranged into a 27-card Wood pile, three face-up cards, and a 10-card Blitz pile. Play begins after a 10-second countdown.

## Round rules

- Start a shared pile with a 1. Each next card must be one rank higher and the same color. A 10 on a 9 goes face down and closes the pile.
- Play one of the three face-up cards to move the top Blitz card into its spot. The round ends as soon as a racer empties their Blitz pile.
- Flip up to three cards from Wood at a time. Playing the exposed card reveals the next card in that batch. You can wait for a match or advance to the next batch. At the end of the stock, shuffle all unplayed Wood cards for the next pass.
- Score one point for each card you played to the table and lose two points for each card left in your Blitz pile.

You sit at the bottom of the table. Tap or drag a face-up card or the exposed Wood card. Settings can enable any-color runs, same-color matches, and descending plays for the next round.

## Games and levels

Enter a player name and choose the difficulty, number of players, and number of rounds. Scores add up across a game. Free Play starts every round at zero and awards XP for that round's placement instead.

First through fourth place award 100, 75, 50, and 25 XP. Level 1 takes 100 XP, level 2 takes another 200 XP, and each level after that costs 100 XP more. Progress follows the entered name in the current browser.

## Play and install

The [GitHub Pages site](https://owningturtle287.github.io/Dutch-Blitz-Game/) is published by the [Pages workflow](../../actions/workflows/pages.yml). Pushes to `main` deploy automatically.

On iPhone or iPad, open the site in Safari and tap **Share → Add to Home Screen**. On Android, use Chrome’s **Install app** or **Add to Home Screen** option. Once the first visit has finished loading, you can play offline.

## Develop

Serve `public` with a local web server such as `python3 -m http.server 8000 --directory public`. Run the engine checks with `node --test`.

Suit pictograms come from [Lucide](https://lucide.dev/) under the [ISC license](public/assets/LUCIDE-LICENSE.txt).
