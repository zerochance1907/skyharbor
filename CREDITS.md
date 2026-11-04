# Credits

**Skyharbor** — design, code, world, story, models, music and sound by **zerochance1907**.

## Original content

Everything you see and hear in Skyharbor is original and generated in code at runtime:

| Asset | How it is made |
| --- | --- |
| Floating islands, cliffs, waterfalls | Seeded simplex noise and polar-grid meshes (`src/sim/world.ts`, `src/render/islands.ts`) |
| Trees, rocks, crystals, ruins | Primitive shapes merged with baked vertex colours (`src/render/decorations.ts`) |
| Ports, docks and landmarks | Hand-placed primitive assemblies (`src/render/structures.ts`) |
| Airships, sky-pirates, merchants | Procedural lofted hull and envelope (`src/render/ship.ts`) |
| Birds and sky-whales | Procedural low-poly meshes (`src/render/life.ts`) |
| Sky, sun, moon, stars, clouds | GLSL shaders and a generated noise texture (`src/render/sky.ts`, `src/render/clouds.ts`) |
| Emblems, puff and pillar textures | Drawn with the Canvas 2D API (`src/render/textures.ts`, `src/render/fx.ts`) |
| Soundtrack | Generative WebAudio sequencer with procedural synths (`src/audio/audio.ts`) |
| Sound effects and ambience | Synthesised noise and oscillators (`src/audio/audio.ts`) |
| Story, characters, places, goods | Written for this game |

No image, model, font or audio files are shipped. The UI uses the system font stack.
The characters, places and factions (the Cartographers' Guild, the Gullwake Corsairs,
Skyharbor, the Hollow Meridian and the rest) are original to this project.

## Open-source software

- [Three.js](https://threejs.org/) — MIT License — 3D rendering, post-processing passes
- [Vite](https://vitejs.dev/) — MIT License — dev server and bundler
- [TypeScript](https://www.typescriptlang.org/) — Apache-2.0 — language
- [Vitest](https://vitest.dev/) — MIT License — unit tests
- [Playwright](https://playwright.dev/) — Apache-2.0 — end-to-end tests
