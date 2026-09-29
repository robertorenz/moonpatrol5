# Lunar Patrol

A high-resolution browser tribute to **Moon Patrol**, the 1982 arcade classic. Drive a
six-wheeled patrol buggy across the lunar surface from point **A** to point **Z**: jump
craters, blast rocks, and fight off attackers from the sky. As in the original, one fire button
shoots **forward and upward at once**.

It's plain HTML, CSS and JavaScript with no build step and no dependencies. Everything is drawn
as vector graphics at your screen's native resolution, and the view fills the whole window.

## Play

Serve the folder and open it in a browser:

```bash
python -m http.server 8765
# then browse to http://localhost:8765
```

Opening `index.html` straight from disk also works in most browsers.

### Controls

| Action | Keys |
| --- | --- |
| Speed up / slow down | `→` `←` (or `D` `A`) |
| Jump | `↑` `Space` `Z` `W` |
| Fire (forward + up) | `X` `Ctrl` `F` |
| Start | `Enter` |
| Pause | `P` `Esc` |
| Sound on/off | `M` |

Touch devices get on-screen buttons.

## Features

- **Arcade gameplay:** a Beginner course A–Z, then a harder Champion course. Checkpoints at
  E, J, O, T and Z have timed bonuses, and losing a buggy restarts you at the last checkpoint.
- **Hazards:** small and wide craters, rocks (big ones split in two), rolling boulders, mines
  you can only jump, and tanks that fire shells along the ground.
- **Air attack:** three UFO types. Saucers drop bombs, orange pods drop bombs that blast new
  craters in your path, and green darts dive at you. Bombs fall slowly onto the scrolling
  ground, so you dodge them by speeding up or slowing down. Holding → lets the buggy drive
  well forward on the screen.
- **Checkpoint celebrations:** the action stops, enemies retreat, and the buggy rolls to a halt
  and hops under fireworks while a fanfare plays. A slim banner shows your time, the average
  time, the record and a bonus that counts up. Then it's "GO!" and back to driving. Reaching Z
  gets a longer celebration before the Champion course.
- **Presentation:**
  - Parallax star field and icy mountain ranges, with green hills or a lunar city skyline
    alternating between checkpoints.
  - Rolling cratered terrain.
  - A buggy whose body tilts on its suspension over bumps, take-offs and landings.
  - Glowing shots and explosions.
- **Views:** *Fill screen* widens the playfield to fit any window. *Arcade 4:3* keeps the
  original screen shape. Hazards engage at arcade distance, so both views play the same.
  There's also an optional CRT overlay.
- **Arcade touches:**
  - Warning lamps for air attack, ground attack and mines.
  - Extra buggies at 10,000, 30,000 and 50,000 points.
  - An attract mode with the title, score table, demo play and a top-5 high-score board
    (saved in `localStorage`).
- **Sound:** WebAudio-synthesized sound effects and an original chiptune soundtrack and
  fanfare.

## Project layout

```
index.html        page shell, modal dialogs, touch controls
css/style.css     page styling
js/audio.js       WebAudio sound effects, music sequencer, fanfare
js/game.js        simulation, level generation, vector renderer
js/ui.js          dialogs, input mapping, resolution/view scaling, preferences
```

For testing, `Game._tick(frames, autopilot)` advances the simulation synchronously and
`Game._state()` exposes the internal state. The built-in autopilot was used to check that the
generated courses have no impossible obstacle layouts.

## Credits

- **Moon Patrol** (1982) was developed and published by **Irem**. It was designed by
  **Takashi Nishiyama** and distributed in North America by **Williams Electronics**. This
  project is an homage to its gameplay and would not exist without it.
- Typefaces from Google Fonts, all under the SIL Open Font License:
  - **Orbitron** by Matt McInerney
  - **Inter** by Rasmus Andersson
  - **Press Start 2P** by CodeMan38
- Created by **Roberto Renz** with **Claude Code** (Anthropic).

## Disclaimer

Lunar Patrol is a non-commercial fan tribute. It is not affiliated with, endorsed by, or
connected to Irem or any rights holder of Moon Patrol. "Moon Patrol" is a trademark of its
respective owner. All code, graphics, sound effects and music in this repository are original
work created for this project. No assets from the original game are used.
