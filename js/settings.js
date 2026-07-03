/*
 * Settings page: edit your Avo params. Preview updates live; explicit Save
 * commits to the library + active avatar (localStorage).
 */

let params = Avo.loadParams() || Object.assign({}, Avo.DEFAULTS, { name: 'Han' });
let dirty = false;

const previewTile = document.querySelector('.preview-tile');
const avo = Avo.mount(document.getElementById('preview-holder'), {
  params,
  getLevel: () => VoiceLevel.level(),
  onLevel: (lvl) => {
    document.getElementById('level-fill').style.width = `${Math.round(lvl * 100)}%`;
  },
  onSpeaking: (s) => previewTile.classList.toggle('speaking', s),
});

const saveState = document.getElementById('save-state');
let saveFlash = null;

function setDirty(isDirty) {
  dirty = isDirty;
  saveState.textContent = dirty ? 'unsaved' : 'saved ✓';
  saveState.classList.toggle('flash', !dirty);
  saveState.classList.toggle('warn', dirty);
}

function flashSaved() {
  saveState.textContent = 'saved ✓';
  saveState.classList.remove('warn');
  saveState.classList.add('flash');
  clearTimeout(saveFlash);
  saveFlash = setTimeout(() => saveState.classList.remove('flash'), 1200);
}

/** Preview-only update (does not persist until Save). */
function preview(patch) {
  params = Object.assign({}, params, patch);
  avo.setParams(params);
  document.getElementById('preview-name').textContent = params.name;
  setDirty(true);
}

function loadParamsIntoEditor(next) {
  params = Avo.normalizeParams(next);
  avo.setParams(params);
  syncUI();
  setDirty(false);
}

/* Static thumbnails, generated once per saved entry and cached. */
const thumbCache = new Map();

function setThumb(img, entry) {
  if (thumbCache.has(entry.id)) {
    img.src = thumbCache.get(entry.id);
    return;
  }
  Avo.snapshot(entry.params, 168).then((url) => {
    thumbCache.set(entry.id, url);
    img.src = url;
  }).catch(() => {
    // Fallback: plain color disc if snapshot fails.
    img.style.background = `hsl(${entry.params.hue}, 70%, 62%)`;
  });
}

function renderSavedList() {
  const listEl = document.getElementById('saved-list');
  const emptyEl = document.getElementById('saved-empty');
  const saved = Avo.listSaved();

  listEl.innerHTML = '';
  emptyEl.hidden = saved.length > 0;

  for (const entry of saved) {
    const li = document.createElement('li');
    li.className = 'saved-item';

    const thumb = document.createElement('img');
    thumb.className = 'saved-thumb';
    thumb.alt = `${entry.label} preview`;
    setThumb(thumb, entry);

    const meta = document.createElement('div');
    meta.className = 'saved-meta';
    const title = document.createElement('span');
    title.className = 'saved-name';
    title.textContent = entry.label;
    const sub = document.createElement('span');
    sub.className = 'saved-sub';
    sub.textContent = `${Avo.STYLE_LABELS[entry.params.style] || entry.params.style} · ${entry.params.name}`;
    meta.append(title, sub);

    const actions = document.createElement('div');
    actions.className = 'saved-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn ghost saved-btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => {
      loadParamsIntoEditor(entry.params);
      Avo.saveParams(entry.params);
      flashSaved();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn ghost saved-btn saved-del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      Avo.deleteSaved(entry.id);
      thumbCache.delete(entry.id);
      renderSavedList();
    });

    actions.append(loadBtn, delBtn);
    li.append(thumb, meta, actions);
    listEl.appendChild(li);
  }
}

/* ---- name ---- */
const nameInput = document.getElementById('name-input');
nameInput.value = params.name;
nameInput.addEventListener('input', () => {
  preview({ name: nameInput.value.trim() || 'guest' });
});

/* ---- style ---- */
const styleSeg = document.getElementById('style-seg');
for (const style of Avo.STYLES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.style = style;
  btn.textContent = Avo.STYLE_LABELS[style];
  btn.addEventListener('click', () => { preview({ style }); syncUI(); });
  styleSeg.appendChild(btn);
}

/* ---- color ---- */
const swatchWrap = document.getElementById('swatches');
for (const { h, name } of Avo.PALETTE) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'swatch';
  el.title = name;
  el.setAttribute('aria-label', `color ${name}`);
  el.dataset.hue = h;
  el.style.background = `hsl(${h}, 70%, 62%)`;
  el.addEventListener('click', () => { preview({ hue: h }); syncUI(); });
  swatchWrap.appendChild(el);
}

/* ---- energy ---- */
const energySlider = document.getElementById('energy');
energySlider.addEventListener('input', () => {
  preview({ energy: parseFloat(energySlider.value) });
  document.getElementById('energy-val').textContent = energySlider.value;
});

/* ---- shuffle / reset ---- */
document.getElementById('shuffle-btn').addEventListener('click', () => {
  preview(Avo.randomParams(params.name));
  avo.pop();
  syncUI();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  preview(Object.assign({}, Avo.DEFAULTS, { name: params.name }));
  syncUI();
});

/* ---- save / export / import ---- */
document.getElementById('save-avo-btn').addEventListener('click', () => {
  Avo.saveToLibrary(params, params.name);
  setDirty(false);
  flashSaved();
  renderSavedList();
  avo.pop();
});

document.getElementById('export-btn').addEventListener('click', () => {
  Avo.exportToFile(params);
});

const importFile = document.getElementById('import-file');
document.getElementById('import-btn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const imported = await Avo.importFromFile(file);
    preview(imported);
    syncUI();
    nameInput.value = params.name;
  } catch (_) {
    alert('Could not read that file — expected a valid .avo.json');
  }
});

/* ---- keep controls in sync with params ---- */
function syncUI() {
  styleSeg.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.style === params.style));
  swatchWrap.querySelectorAll('.swatch').forEach((s) =>
    s.classList.toggle('on', Number(s.dataset.hue) === params.hue));
  energySlider.value = params.energy;
  document.getElementById('energy-val').textContent = params.energy;
  document.getElementById('preview-name').textContent = params.name;
  nameInput.value = params.name;
}
syncUI();
setDirty(false);
renderSavedList();

/* ---- mic test ---- */
const micBtn = document.getElementById('mic-btn');
micBtn.addEventListener('click', async () => {
  const ok = await VoiceLevel.enableMic();
  if (ok) {
    micBtn.textContent = '🎙 Mic live';
    micBtn.classList.add('live');
    micBtn.disabled = true;
  } else {
    micBtn.textContent = '🎙 Mic blocked — use Simulate';
  }
});

const simBtn = document.getElementById('sim-btn');
simBtn.addEventListener('click', () => {
  const on = VoiceLevel.toggleSim();
  simBtn.classList.toggle('on', on);
  simBtn.textContent = on ? 'Stop simulation' : 'Simulate voice';
});

/* ---- reaction previews ---- */
document.getElementById('poke-btn').addEventListener('click', () => avo.pop());
document.getElementById('pet-btn').addEventListener('click', () => avo.pet());
