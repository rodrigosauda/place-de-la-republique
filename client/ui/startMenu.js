// client/ui/startMenu.js
// The HTML overlay shown before playing: name, faction, placard slogan and
// the outfit editor (with a live 3D preview). Calls onPlay(...) once.

import { FACTIONS, MAX_NAME_LENGTH, MAX_SLOGAN_LENGTH } from '../../shared/constants.js';
import { createOutfitEditor, loadSavedLook, saveLook } from './outfitEditor.js';

export function showStartMenu(onPlay) {
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.innerHTML = `
    <form class="menu-card wide">
      <div class="menu-left">
        <h1>Place de la République</h1>
        <p class="subtitle">A protest day on Place de la République in Paris: the crowd gathers in the morning, marches at 14:00,
          clashes with the police at 17:00, and the curfew starts at 23:00. Pick a side. Cartoon brawls only: 3 bonks and you're K.O. Protesters fight with a baguette, police with a rubber chicken.</p>

        <span class="label">Faction</span>
        <div class="factions">
          ${Object.entries(FACTIONS).map(([code, f], i) => `
            <label class="faction">
              <input type="radio" name="faction" value="${code}" ${i === 0 ? 'checked' : ''} />
              <span class="swatch" style="background:#${f.color.toString(16).padStart(6, '0')}"></span>
              <span>${f.label}</span>
            </label>`).join('')}
        </div>

        <label for="name">Your name</label>
        <input id="name" name="name" maxlength="${MAX_NAME_LENGTH}" placeholder="Your name" autocomplete="off" required />

        <label for="slogan" class="slogan-label">Your placard (Yellow Vests)</label>
        <input id="slogan" name="slogan" maxlength="${MAX_SLOGAN_LENGTH}" placeholder="Lower prices!" autocomplete="off" />

        <button type="submit">Play</button>
        <p class="help">Mouse: look around · Shift: run · C: dodge roll · Click / F: hit · Right mouse / Q: block · G: grab/throw ·
          E: truck · H: tear gas (Police) · T: emotes · V: tag a wall · Enter: chat · 1–4: chants · M: mute · Esc: free the mouse</p>
      </div>
      <div class="menu-right"></div>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const nameInput = form.querySelector('#name');
  const sloganInput = form.querySelector('#slogan');
  const right = form.querySelector('.menu-right');
  try {
    nameInput.value = localStorage.getItem('playerName') || '';
    sloganInput.value = localStorage.getItem('playerSlogan') || '';
  } catch { /* ignore */ }
  nameInput.focus();

  let faction = 'g';
  let editor = null;
  let look = null;
  const buildEditor = () => {
    editor?.destroy();
    look = loadSavedLook(faction);
    editor = createOutfitEditor({
      faction, look, slogan: sloganInput.value.trim(),
      onChange: (l) => { look = l; saveLook(faction, l); },
    });
    right.appendChild(editor.element);
  };

  const updateFaction = () => {
    faction = new FormData(form).get('faction');
    sloganInput.disabled = faction !== 'g';
    form.querySelector('.slogan-label').style.opacity = faction === 'g' ? 1 : 0.4;
    buildEditor();
  };
  form.querySelectorAll('input[name=faction]').forEach((r) => r.addEventListener('change', updateFaction));
  sloganInput.addEventListener('change', buildEditor); // redraw the placard in the preview
  updateFaction();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim().slice(0, MAX_NAME_LENGTH) || 'Anonymous';
    const slogan = faction === 'g' ? sloganInput.value.trim() || 'Lower prices!' : '';
    try {
      localStorage.setItem('playerName', name);
      localStorage.setItem('playerSlogan', sloganInput.value.trim());
    } catch { /* ignore */ }
    const finalLook = editor.getLook();
    editor.destroy();
    overlay.remove();
    onPlay({ name, faction, slogan, look: finalLook });
  });
}
