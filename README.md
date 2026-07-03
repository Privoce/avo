# Avo — VoceSpace's voice-reactive avatar (p5.js)

A camera-free way to represent users in a VoceSpace room. Each participant is
an **Avo**: a small procedural creature rendered with p5.js that reacts to the
user's voice and pointer, replacing the gray silhouette in participant tiles.

- **Voice-reactive** — body swells, mouth opens, halos/orbits/pulses speed up
  with the speaker's audio level (Web Audio `AnalyserNode` in this demo; in
  the real app, feed it LiveKit's per-participant audio level).
- **Alive when idle** — breathing, blinking, wandering eyes.
- **Pointer-interactive** — eyes follow the cursor, the body leans toward it,
  hovering excites it, rubbing pets it (happy squint + hearts), clicking pokes
  it (sparkle burst).
- **Theme-harmonic colors** — the whole palette is derived from the VoceSpace
  cyan (`THEME_HUE = 193`) via color-harmony offsets, so every possible Avo
  (including random shuffles) matches the product theme by construction.

## Run locally

No build step. Any static file server works:

```bash
python3 -m http.server 8123
# then open http://localhost:8123
```

p5.js is vendored in `lib/` (installed once via `npm install p5`), so the page
works fully offline.

The page is the Avo settings screen: live preview (talk / poke / pet it) plus
name, style, color, energy, shuffle, and reset controls. Changes auto-save to
localStorage — in VoceSpace this screen becomes the per-user Avo settings page,
and the resulting params render inside each participant tile.

## Integration

Everything the VoceSpace app needs is **`js/avo.js`** (plus p5.js). An Avo is
fully described by 5 serializable values:

```js
{ name: 'Han', variant: 0, hue: 193, style: 'blob', energy: 0.6 }
```

Sync those few bytes through your existing room state and every client renders
the identical Avo locally — no images, no video tracks.

```js
// One Avo per participant tile:
const avo = Avo.mount(tileElement, {
  params: user.avoParams,
  getLevel: () => participant.audioLevel,  // 0..1, e.g. from LiveKit
  onSpeaking: (s) => tileElement.classList.toggle('speaking', s),
  onLevel: (lvl) => {},                    // optional, for meters
  interactive: true,                       // pointer reactions
});

avo.setParams(newParams);  // room state updated
avo.pop();                 // remote "nudge" gesture
avo.destroy();             // participant left
```

Other API surface:

- `Avo.PALETTE` / `Avo.STYLES` — build your own pickers
- `Avo.randomParams(name)` — harmonic shuffle
- `Avo.loadParams()` / `Avo.saveParams(p)` — active avatar (localStorage in the
  demo; swap for your API in production)
- `Avo.saveToLibrary(p, label?)` / `Avo.listSaved()` / `Avo.deleteSaved(id)` —
  saved-Avo library (preset slots, max 12)
- `Avo.snapshot(p, size?)` — static one-frame PNG dataURL for previews/lists
- `Avo.exportToFile(p)` / `Avo.importFromFile(file)` — share as `.avo.json`
- `Avo.normalizeParams(p)` — validate/clamp any received or imported params

## Files

| File | Purpose |
| --- | --- |
| `js/avo.js` | The whole widget: rendering core + mount API + params persistence. Copy this into the app. |
| `js/audio.js` | `VoiceLevel` — demo-only mic level via Web Audio, plus a no-mic simulation mode |
| `js/settings.js` | Settings page wiring (controls, auto-save) |

## Cost notes

Pure 2D canvas, no WebGL, no assets; each Avo is a few dozen shapes per frame
and runs fine on low-end laptops. One p5 instance per tile; call
`handle.destroy()` when a tile unmounts.
# avo
