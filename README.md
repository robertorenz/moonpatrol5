# Lunar Patrol

A high-resolution browser remake of the classic 1982 lunar-buggy arcade game. It keeps the
original's gameplay: a six-wheeled patrol buggy with independent suspension that tilts over
rolling terrain, layered parallax scenery, and a single fire button that shoots **forward and
upward at once**. The course runs **A to Z** with timed checkpoints.

Everything is drawn as smooth vector graphics at your display's native resolution, and the view
fills the whole window, widescreen included. All graphics, sound effects and music are original
and generated in code. The game uses no copyrighted assets.

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

- Resolution-independent vector rendering (sharp on 4K and high-DPI screens)
- **View: Fill screen** widens the playfield to fit any window shape; **View: Arcade 4:3**
  keeps the original screen shape. Tanks and boulders activate at arcade-screen distance, so
  the gameplay is the same in both views. There's also an optional CRT overlay.
- Parallax layers: twinkling star field, icy blue mountain ranges, then green hills or a lunar
  city skyline (they alternate between checkpoints), and rolling cratered ground
- Buggy with suspension struts, rolling wheels and body tilt over bumps, jumps and landings
- Hazards: craters (small and wide), rocks (big ones split in two), rolling boulders, mines,
  tanks that fire along the ground
- Three UFO types: saucers, crater-blasting orange pods, and diving darts
- Beginner course A–Z, then the harder Champion course
- Checkpoints at E, J, O, T and Z: the action stops, enemies retreat, and the buggy rolls to a
  halt at the signpost and hops under fireworks while a victory fanfare plays. A slim
  "HOORAY!" banner at the top shows your time, the average time, the top record and a bonus
  that counts up. Then it's "GO!" and the music restarts. Reaching Z plays a longer
  celebration before the Champion course. Losing a buggy restarts you at the last checkpoint.
- Warning lamps for air attack, ground attack and mines
- Extra buggies at 10,000, 30,000 and 50,000 points
- Attract mode (title, score table, autopilot demo, high scores), with a top-5 high-score
  board saved in `localStorage`
- WebAudio synth sound effects and an original chiptune soundtrack

## Project layout

```
index.html        page shell, modals, touch controls
css/style.css     page styling
js/audio.js       WebAudio SFX + music sequencer
js/game.js        simulation, level generation, vector renderer
js/ui.js          modal dialogs, input mapping, resolution/view scaling, preferences
```

## Testing hook

`Game._tick(frames, autopilot)` advances the simulation synchronously, and `Game._state()`
exposes the internal state. The level generator was checked with the built-in autopilot,
which clears the whole Beginner course without losing a buggy.
