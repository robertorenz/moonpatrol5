# Lunar Patrol

A browser remake of the classic 1982 lunar-buggy arcade game. It recreates the original's
feel: a six-wheeled patrol buggy with independently bouncing wheels, multi-layer parallax
scrolling, and a single fire button that shoots **forward and upward at once**. The course
runs **A to Z** with timed checkpoints.

All graphics, sound effects and music are original, generated in code. The game uses no
copyrighted assets.

## Running

It's plain HTML/JS with no build step. Serve the folder and open `index.html`:

```bash
python -m http.server 8765
# then browse to http://localhost:8765
```

Opening `index.html` straight from disk also works in most browsers.

## Controls

| Action | Keys |
| --- | --- |
| Speed up / slow down | `←` `→` (or `A` `D`) |
| Jump | `↑` `Space` `Z` `W` |
| Fire (forward + up) | `X` `Ctrl` `F` |
| Start | `Enter` |
| Pause | `P` `Esc` |
| Sound on/off | `M` |

Touch devices get on-screen buttons.

## Features

- Native 256×224 arcade resolution with crisp integer scaling and optional CRT scanlines
- Parallax layers: star field, blue mountains, green hills with a lunar colony, scrolling ground
- Hazards: craters (small and wide), rocks (big ones split in two), rolling boulders, mines,
  tanks that fire along the ground
- Three UFO types: saucers, crater-blasting orange pods, and diving darts
- Beginner course A–Z, then the harder Champion course
- Checkpoints at E, J, O, T and Z, each showing your time, the average time, the top record
  and a bonus. Losing a buggy restarts you at the last checkpoint.
- Warning lamps for air attack, ground attack and mines
- Extra buggies at 10,000, 30,000 and 50,000 points
- Attract mode (title, score table, autopilot demo, high scores), with a top-5 high-score
  board saved in `localStorage`
- WebAudio synth sound effects and an original chiptune soundtrack

## Project layout

```
index.html        page shell, modals, touch controls
css/style.css     page styling
js/font.js        5x7 bitmap arcade font
js/sprites.js     pixel-art sprites (built at load time)
js/audio.js       WebAudio SFX + music sequencer
js/game.js        simulation, level generation, rendering
js/ui.js          modal dialogs, input mapping, scaling, preferences
```

## Testing hook

`Game._tick(frames, autopilot)` advances the simulation synchronously, and `Game._state()`
exposes the internal state. The level generator was checked with the built-in autopilot,
which clears the whole Beginner course.
