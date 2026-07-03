/*
 * Avo — VoceSpace's voice-reactive avatar widget.
 *
 * Integration-ready, single file, only dependency is p5.js.
 * An Avo is fully described by 5 serializable values (the "params"):
 *
 *   { name, variant, hue, style, energy }
 *
 * name    string  display name; seeds the creature's personality
 * variant int     re-rolls the personality without changing the name
 * hue     number  must come from Avo.PALETTE (harmonic with the theme)
 * style   string  'blob' | 'ring' | 'wave'
 * energy  number  0.1..1, how strongly it reacts to voice
 *
 * Sync these few bytes through your existing room state and every client
 * renders the identical Avo locally — no images, no video tracks.
 *
 * Public API:
 *
 *   const handle = Avo.mount(tileElement, {
 *     params: user.avoParams,                 // optional, defaults to saved/DEFAULTS
 *     getLevel: () => participant.audioLevel, // 0..1, e.g. LiveKit audio level
 *     onSpeaking: (bool) => {...},            // speaking state changed
 *     onLevel: (lvl) => {...},                // every frame, for meters
 *     interactive: true,                      // pointer reactions (default true)
 *     scale: 0.62,                            // avatar size vs container
 *   });
 *
 *   handle.setParams({ hue: 235 });  // partial update, e.g. from room state
 *   handle.getParams();
 *   handle.pop();                    // programmatic "poke" (e.g. remote nudge)
 *   handle.destroy();
 *
 *   Avo.loadParams() / Avo.saveParams(p)  // active avatar (localStorage)
 *   Avo.listSaved() / Avo.saveToLibrary(p, label?) / Avo.deleteSaved(id)
 *   Avo.snapshot(p, size?)                // static preview dataURL (one frame)
 *   Avo.exportToFile(p) / Avo.importFromFile(file)
 */
(function (global) {
'use strict';

/*
 * Palette derived from the VoceSpace theme cyan (#29c9e9, hue ~193) using
 * classic color-harmony offsets, so every possible Avo color is harmonic
 * with the theme by construction:
 *   0, ±21, ±42  → analogous band (mint, teal, cyan, azure, indigo)
 *   +150, +210   → split-complementary accents (pink, amber)
 *   +180         → true complement (coral)
 */
const THEME_HUE = 193;

const HARMONY_OFFSETS = [
  { o: 0,    name: 'cyan'   },
  { o: 21,   name: 'azure'  },
  { o: 42,   name: 'indigo' },
  { o: -21,  name: 'teal'   },
  { o: -42,  name: 'mint'   },
  { o: 210,  name: 'amber'  },
  { o: 180,  name: 'coral'  },
  { o: 150,  name: 'pink'   },
];

const PALETTE = HARMONY_OFFSETS.map(({ o, name }) => ({
  h: ((THEME_HUE + o) % 360 + 360) % 360,
  name,
}));

const STYLES = ['blob', 'ring', 'wave'];
const STYLE_LABELS = { blob: 'Blob', ring: 'Orbit', wave: 'Pulse' };

const DEFAULTS = { name: 'guest', variant: 0, hue: PALETTE[0].h, style: 'blob', energy: 0.6 };
const STORAGE_KEY = 'avo.params.v1';
const SAVED_KEY = 'avo.saved.v1';

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

/* Small vector heart used by pet particles. */
function drawHeart(p, x, y, s) {
  p.beginShape();
  p.vertex(x, y + s * 0.35);
  p.bezierVertex(x - s, y - s * 0.35, x - s * 0.45, y - s, x, y - s * 0.3);
  p.bezierVertex(x + s * 0.45, y - s, x + s, y - s * 0.35, x, y + s * 0.35);
  p.endShape(p.CLOSE);
}

/* ================= creature (rendering core) ==================== */

class Creature {
  constructor(params) {
    this.blink = 0;       // 0 open .. 1 closed
    this.nextBlink = 1 + Math.random() * 3;
    this.popT = 99;       // time since last "pop"
    this.hover = 0;       // 0..1 pointer-over-body excitement
    this.petGlow = 0;     // 0..1 happiness from being petted
    this.leanX = 0;       // smoothed lean toward pointer
    this.leanY = 0;
    this.particles = [];  // hearts + sparkles
    this.applyParams(params);
  }

  applyParams(params) {
    const q = Object.assign({}, DEFAULTS, params);
    this.hue = q.hue;
    this.style = q.style;
    this.energy = q.energy;
    this.name = q.name;
    // Personality knobs derived from name + variant:
    const s = hashString((q.name || 'guest') + '#' + (q.variant | 0));
    this.seed = s;
    this.lobes = 5 + (s % 4);
    this.orbiters = 6 + (s >> 3) % 7;
    this.squish = 0.85 + ((s >> 6) % 30) / 100;
    this.eyeGap = 0.30 + ((s >> 9) % 14) / 100;
    this.eyeSize = 0.10 + ((s >> 12) % 8) / 100;
    this.noiseOff = (s % 1000) / 10;
  }

  pop() {
    this.popT = 0;
    this.blink = 0; // keep eyes open for the startle beat
    // A few soft sparks — enough to feel tactile, not celebratory.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
      const v = 1.0 + Math.random() * 1.6;
      this.spawnParticle('spark', Math.cos(a) * 8, Math.sin(a) * 8,
        Math.cos(a) * v, Math.sin(a) * v);
    }
  }

  /* Programmatic petting (touch devices, remote gestures, previews). */
  pet() {
    this.petGlow = 1;
    for (let i = 0; i < 5; i++) {
      this.spawnParticle('heart',
        (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 1.2, -1.5 - Math.random());
    }
  }

  spawnParticle(type, x, y, vx, vy) {
    if (this.particles.length > 40) this.particles.shift();
    this.particles.push({ type, x, y, vx, vy, life: 1, spin: Math.random() * 6 });
  }

  /* state = { t, level, pointer: {x,y}|null, pointerSpeed } */
  render(p, x, y, size, state) {
    const { t, level, pointer } = state;
    const pointerSpeed = state.pointerSpeed || 0;
    const dt = p.deltaTime / 1000;
    this.popT += dt;

    // Blink bookkeeping.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 1; this.nextBlink = 1.5 + Math.random() * 3.5; }
    this.blink = Math.max(0, this.blink - p.deltaTime / 110);

    /* ---- pointer state ---- */
    const r0 = size * 0.5;
    const overBody = !!pointer && Math.hypot(pointer.x, pointer.y) < r0 * 0.95;

    // Hover excitement eases in/out.
    this.hover += ((overBody ? 1 : 0) - this.hover) * Math.min(1, dt * 8);

    // Petting: rub the cursor across the body.
    if (overBody && pointerSpeed > 3) {
      this.petGlow = Math.min(1, this.petGlow + pointerSpeed * 0.0035);
      if (this.petGlow > 0.3 && Math.random() < 0.12) {
        this.spawnParticle('heart',
          pointer.x * 0.8, pointer.y * 0.8,
          (Math.random() - 0.5) * 1.2, -1.5 - Math.random());
      }
    }
    this.petGlow = Math.max(0, this.petGlow - dt * 0.35);

    // Body leans toward a nearby cursor (even outside the body).
    let targetLX = 0, targetLY = 0;
    if (pointer) {
      const m = Math.hypot(pointer.x, pointer.y) || 1;
      const pull = Math.max(0, 1 - m / (r0 * 3.5));
      targetLX = (pointer.x / m) * pull * r0 * 0.16;
      targetLY = (pointer.y / m) * pull * r0 * 0.12;
    }
    this.leanX += (targetLX - this.leanX) * Math.min(1, dt * 6);
    this.leanY += (targetLY - this.leanY) * Math.min(1, dt * 6);

    const pop = Math.max(0, 1 - this.popT * 1.35); // quick startle, ~0.75s
    const breathe = Math.sin(t * 1.4 + this.noiseOff) * 0.02;
    const excite = this.hover * 0.02 + this.petGlow * 0.07;
    const scale = 1 + breathe + level * 0.16 * this.energy + excite;

    p.push();
    // Startled: small hop, faint wobble, jelly squash — not a uniform inflate.
    p.translate(x + this.leanX, y + this.leanY - pop * r0 * 0.07);
    p.rotate(this.leanX / r0 * 0.14 + pop * Math.sin(this.popT * 28) * 0.025);
    const jelly = pop * Math.sin(this.popT * 24) * 0.055;
    p.scale(1 + jelly, 1 - jelly * 0.85);
    p.colorMode(p.HSB, 360, 100, 100, 1);

    const liveliness = Math.min(1, level + this.hover * 0.12 + this.petGlow * 0.5);

    if (this.style === 'blob') this.drawBlob(p, size * scale, t, liveliness, pop);
    else if (this.style === 'ring') this.drawRing(p, size * scale, t, liveliness, pop);
    else this.drawWave(p, size * scale, t, liveliness, pop);

    this.drawFace(p, size * scale, t, level, pointer);
    this.drawParticles(p, size, dt);
    p.colorMode(p.RGB, 255);
    p.pop();
  }

  drawParticles(p, size, dt) {
    const k = size / 100;
    p.noStroke();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt * (pt.type === 'heart' ? 0.7 : 1.4);
      if (pt.life <= 0) { this.particles.splice(i, 1); continue; }
      pt.x += pt.vx * k;
      pt.y += pt.vy * k;
      pt.vx *= 0.97;
      if (pt.type === 'heart') pt.vy -= dt * 1.2;
      pt.spin += dt * 3;

      if (pt.type === 'heart') {
        p.fill((THEME_HUE + 150) % 360, 65, 100, pt.life * 0.9);
        drawHeart(p, pt.x, pt.y + Math.sin(pt.spin) * 1.5, (5 + (1 - pt.life) * 4) * k);
      } else {
        p.fill(this.hue, 45, 100, pt.life);
        const s = (2 + pt.life * 3) * k;
        p.push();
        p.translate(pt.x, pt.y);
        p.rotate(pt.spin);
        p.rect(-s / 2, -s / 2, s, s, s * 0.3);
        p.pop();
      }
    }
  }

  drawBlob(p, size, t, level, pop) {
    const r = size * 0.5;
    const wob = (0.06 + level * 0.22 * this.energy + pop * 0.1) * r;

    if (level > 0.04) {
      p.noStroke();
      p.fill(this.hue, 70, 90, 0.06 + level * 0.12);
      p.circle(0, 0, size * (1.25 + level * 0.35));
    }

    p.noStroke();
    for (let layer = 2; layer >= 0; layer--) {
      const lr = r * (1 + layer * 0.10);
      const alpha = layer === 0 ? 1 : 0.16 - layer * 0.04;
      p.fill(this.hue, 62 - layer * 8, layer === 0 ? 78 : 90, alpha);
      p.beginShape();
      for (let a = 0; a < p.TWO_PI; a += 0.22) {
        const n = p.noise(
          Math.cos(a) * 0.8 + this.noiseOff,
          Math.sin(a) * 0.8 + this.noiseOff,
          t * (0.35 + level * 1.2) + layer * 3
        );
        const rr = lr + (n - 0.5) * 2 * wob;
        p.curveVertex(Math.cos(a) * rr * this.squish, Math.sin(a) * rr);
      }
      p.endShape(p.CLOSE);
    }
  }

  drawRing(p, size, t, level, pop) {
    const r = size * 0.5;

    p.noStroke();
    p.fill(this.hue, 55, 75);
    p.circle(0, 0, r * 1.1);
    p.fill(this.hue, 40, 92, 0.35);
    p.circle(0, 0, r * 1.28);

    const speed = 0.5 + level * 2.4 * this.energy + pop * 1.5;
    for (let i = 0; i < this.orbiters; i++) {
      const frac = i / this.orbiters;
      const a = t * speed * (0.6 + frac * 0.7) + frac * p.TWO_PI + this.noiseOff;
      const orbitR = r * (0.75 + frac * 0.45) + level * r * 0.3;
      const px = Math.cos(a) * orbitR;
      const py = Math.sin(a) * orbitR * 0.92;
      const d = r * (0.10 + frac * 0.10) * (1 + level * 0.8);
      // Shimmer stays within ±12° of the base hue to preserve harmony.
      const satHue = (this.hue + (frac - 0.5) * 24 + 360) % 360;
      p.fill(satHue, 70, 95, 0.85);
      p.circle(px, py, d);
      p.fill(satHue, 70, 95, 0.25);
      p.circle(Math.cos(a - 0.25) * orbitR, Math.sin(a - 0.25) * orbitR * 0.92, d * 0.6);
    }
  }

  drawWave(p, size, t, level, pop) {
    const r = size * 0.5;

    p.noStroke();
    p.fill(this.hue, 55, 75);
    p.circle(0, 0, r * 1.15);

    p.noFill();
    const rings = 4;
    for (let i = 0; i < rings; i++) {
      const phase = ((t * (0.5 + level * 1.6) + i / rings) % 1);
      const rr = r * (0.6 + phase * (0.9 + level * 0.9 + pop * 0.4));
      const alpha = (1 - phase) * (0.16 + level * 0.55);
      p.stroke(this.hue, 65, 95, alpha);
      p.strokeWeight(2 + (1 - phase) * 3 + level * 2);
      p.circle(0, 0, rr * 2);
    }
    p.noStroke();
  }

  drawFace(p, size, t, level, pointer) {
    const r = size * 0.5;

    // Poked: brief startle. Petted: happy squint. Hover: curious look.
    const startle = Math.max(0, 1 - this.popT / 0.55);
    const happy = startle > 0.25 ? 0 : this.petGlow;
    const curious = startle > 0.25 ? 0 : Math.max(0, this.hover * (1 - happy * 1.4));

    let lookX = 0, lookY = 0;
    if (pointer) {
      const dx = pointer.x, dy = pointer.y;
      const m = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, m / (r * 2));
      lookX = (dx / m) * k * r * 0.09;
      lookY = (dy / m) * k * r * 0.09;
    } else {
      lookX = Math.cos(t * 0.6 + this.noiseOff) * r * 0.04;
      lookY = Math.sin(t * 0.45 + this.noiseOff) * r * 0.03;
    }
    // Curious: lean into the gaze a little more.
    const lookBoost = 1 + curious * 0.4;
    lookX *= lookBoost;
    lookY *= lookBoost;
    // Snap gaze forward; eyes drift up a touch at peak surprise.
    lookX *= 1 - startle * 0.75;
    lookY = lookY * (1 - startle * 0.75) - startle * r * 0.03 - curious * r * 0.018;

    const eyeY = -r * 0.08 + lookY;
    const gap = r * this.eyeGap;
    const eyeR = r * this.eyeSize * 2 * (1 + startle * 0.16 + curious * 0.08);
    const openness = Math.max(1 - this.blink, 0.85 + startle * 0.15 + curious * 0.06);
    const pupilK = 0.45 * (1 - startle * 0.28 + curious * 0.14);

    if (happy > 0.35) {
      // Happy squint: ∩-shaped closed eyes (scaled down vs open eyes).
      const hEye = eyeR * 0.8;
      p.noFill();
      p.stroke(0, 0, 100, 0.95);
      p.strokeWeight(hEye * 0.22);
      for (const side of [-1, 1]) {
        const ex = side * gap + lookX;
        p.arc(ex, eyeY + hEye * 0.15, hEye, hEye * 0.9, p.PI, p.TWO_PI);
      }
      p.noStroke();
    } else {
      p.noStroke();
      for (const side of [-1, 1]) {
        const ex = side * gap + lookX;
        p.fill(0, 0, 100, 0.95);
        p.ellipse(ex, eyeY, eyeR, eyeR * Math.max(0.08, openness));
        if (openness > 0.35) {
          p.fill(0, 0, 12);
          p.ellipse(ex + lookX * 0.6, eyeY + lookY * 0.4,
            eyeR * pupilK, eyeR * pupilK * openness);
        }
      }
    }

    // Blush while petted.
    if (happy > 0.2) {
      p.noStroke();
      p.fill((THEME_HUE + 180) % 360, 55, 100, (happy - 0.2) * 0.5);
      p.ellipse(-gap * 1.5 + lookX, eyeY + eyeR * 0.9, eyeR * 0.9, eyeR * 0.5);
      p.ellipse(gap * 1.5 + lookX, eyeY + eyeR * 0.9, eyeR * 0.9, eyeR * 0.5);
    }

    // Mouth: startle "o", pet smile, curious "hmm", voice otherwise.
    const mouthY = r * 0.22;
    if (startle > 0.35) {
      const ow = r * (0.07 + startle * 0.05);
      p.fill(0, 0, 10, 0.85);
      p.ellipse(lookX * 0.5, mouthY + lookY * 0.3 + r * 0.01, ow, ow * 1.1);
    } else if (startle > 0.08) {
      // Settling: mouth closes back to a flat line.
      p.fill(0, 0, 10, 0.75);
      const mw = r * 0.22 * (1 - startle);
      p.ellipse(lookX * 0.5, mouthY + lookY * 0.3, mw, r * 0.025);
    } else if (happy > 0.35 && level < 0.12) {
      p.noFill();
      p.stroke(0, 0, 10, 0.85);
      p.strokeWeight(r * 0.045);
      const mw = r * (0.24 + happy * 0.14);
      p.arc(lookX * 0.5, mouthY + lookY * 0.3 - mw * 0.15, mw, mw * 0.8, 0.25, p.PI - 0.25);
      p.noStroke();
    } else if (curious > 0.2 && level < 0.1) {
      // Curious: soft parted lips, like a quiet "hmm?"
      p.fill(0, 0, 10, 0.8);
      const mw = r * (0.14 + curious * 0.04);
      const mh = r * (0.022 + curious * 0.014);
      p.ellipse(lookX * 0.5, mouthY + lookY * 0.3, mw, mh);
    } else {
      const mw = r * 0.30 * (1 + level * 0.25);
      const mh = r * (0.035 + level * 0.30 * this.energy);
      p.fill(0, 0, 10, 0.85);
      p.ellipse(lookX * 0.5, mouthY + lookY * 0.3, mw, mh);
      if (mh > r * 0.09) {
        p.fill(0, 70, 90, 0.9);
        p.ellipse(lookX * 0.5, mouthY + mh * 0.22, mw * 0.5, mh * 0.4);
      }
    }
  }
}

/* ================= params persistence ============================ */

function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeParams(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

function saveParams(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeParams(params)));
  } catch (_) { /* private mode etc. */ }
}

function normalizeParams(raw) {
  const p = Object.assign({}, DEFAULTS, raw || {});
  p.name = String(p.name || 'guest').trim().slice(0, 20) || 'guest';
  p.variant = Number(p.variant) | 0;
  p.energy = Math.round(Math.min(1, Math.max(0.1, Number(p.energy) || DEFAULTS.energy)) * 20) / 20;
  p.style = STYLES.includes(p.style) ? p.style : DEFAULTS.style;
  const hues = PALETTE.map(({ h }) => h);
  p.hue = hues.includes(p.hue) ? p.hue : DEFAULTS.hue;
  return p;
}

function listSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function writeSaved(list) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch (_) { /* private mode etc. */ }
}

/** Save to library and set as the active avatar used in the room. */
function saveToLibrary(params, label) {
  const p = normalizeParams(params);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label: String(label || p.name || 'Avo').trim().slice(0, 24) || 'Avo',
    params: p,
    savedAt: Date.now(),
  };
  const list = listSaved();
  list.unshift(entry);
  if (list.length > 12) list.length = 12;
  writeSaved(list);
  saveParams(p);
  return entry;
}

function deleteSaved(id) {
  writeSaved(listSaved().filter((e) => e.id !== id));
}

/*
 * Render one static frame of an Avo offscreen and return a PNG dataURL.
 * Used for saved-avatar previews — no animation loop, the p5 instance is
 * destroyed as soon as the frame is captured.
 */
function snapshot(params, size) {
  size = size || 96;
  const p5Ctor = global.p5;
  return new Promise((resolve, reject) => {
    if (!p5Ctor) { reject(new Error('p5 not loaded')); return; }
    const holder = document.createElement('div');
    holder.style.cssText =
      `position:fixed;left:-9999px;top:0;width:${size}px;height:${size}px;`;
    document.body.appendChild(holder);

    const creature = new Creature(normalizeParams(params));
    // Deterministic still: no blink, no startle, calm face.
    creature.blink = 0;
    creature.nextBlink = 999;

    const inst = new p5Ctor((p) => {
      p.setup = () => {
        p.createCanvas(size, size);
        p.noLoop();
      };
      p.draw = () => {
        p.clear();
        creature.render(p, size / 2, size / 2, size * 0.62,
          { t: 0.35, level: 0, pointer: null, pointerSpeed: 0 });
        try {
          resolve(p.canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
        setTimeout(() => { inst.remove(); holder.remove(); }, 0);
      };
    }, holder);
  });
}

function exportToFile(params, filename) {
  const p = normalizeParams(params);
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || `${p.name || 'avo'}.avo.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(normalizeParams(JSON.parse(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function randomParams(name) {
  return {
    name: name || 'guest',
    variant: Math.floor(Math.random() * 1e6),
    hue: PALETTE[Math.floor(Math.random() * PALETTE.length)].h,
    style: STYLES[Math.floor(Math.random() * STYLES.length)],
    energy: Math.round((0.4 + Math.random() * 0.5) * 20) / 20,
  };
}

/* ================= mount (embed API) ============================= */

function mount(container, opts) {
  opts = opts || {};
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) throw new Error('Avo.mount: container not found');

  let params = Object.assign({}, DEFAULTS, opts.params || loadParams() || {});
  const creature = new Creature(params);
  const getLevel = opts.getLevel || (() => 0);
  const scale = opts.scale || 0.62;
  const interactive = opts.interactive !== false;
  let speaking = false;
  let destroyed = false;

  const inst = new p5((p) => {
    p.setup = () => {
      const c = p.createCanvas(el.clientWidth || 200, el.clientHeight || 200);
      if (interactive) c.style('cursor', 'pointer');
      c.attribute('aria-label', 'Avo avatar');
    };
    p.draw = () => {
      p.clear();
      const w = p.width, h = p.height;
      const t = p.millis() / 1000;
      const level = getLevel();

      const inside = interactive &&
        p.mouseX >= 0 && p.mouseX <= w && p.mouseY >= 0 && p.mouseY <= h;
      const pointer = inside ? { x: p.mouseX - w / 2, y: p.mouseY - h / 2 } : null;
      const pointerSpeed = inside ? p.dist(p.mouseX, p.mouseY, p.pmouseX, p.pmouseY) : 0;

      creature.render(p, w / 2, h / 2, Math.min(w, h) * scale,
        { t, level, pointer, pointerSpeed });

      if (opts.onLevel) opts.onLevel(level);
      const spk = level > 0.05;
      if (spk !== speaking) {
        speaking = spk;
        if (opts.onSpeaking) opts.onSpeaking(spk);
      }
    };
    p.mousePressed = () => {
      if (interactive &&
          p.mouseX >= 0 && p.mouseX <= p.width &&
          p.mouseY >= 0 && p.mouseY <= p.height) {
        creature.pop();
      }
    };
  }, el);

  const ro = new ResizeObserver(() => {
    if (!destroyed && el.clientWidth && el.clientHeight) {
      inst.resizeCanvas(el.clientWidth, el.clientHeight);
    }
  });
  ro.observe(el);

  return {
    el,
    getParams: () => Object.assign({}, params),
    setParams(patch) {
      params = Object.assign({}, params, patch);
      creature.applyParams(params);
    },
    pop: () => creature.pop(),
    pet: () => creature.pet(),
    destroy() {
      destroyed = true;
      ro.disconnect();
      inst.remove();
    },
  };
}

global.Avo = {
  THEME_HUE,
  PALETTE,
  STYLES,
  STYLE_LABELS,
  DEFAULTS,
  STORAGE_KEY,
  SAVED_KEY,
  mount,
  loadParams,
  saveParams,
  normalizeParams,
  listSaved,
  saveToLibrary,
  deleteSaved,
  snapshot,
  exportToFile,
  importFromFile,
  randomParams,
};

})(window);
