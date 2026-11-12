// client/ui/bottomBar.js
// The menu bar at the bottom of the screen (like manifestacao.com):
//   Outfit · Emotes · Tag · Chat · Menu
// plus the emote picker, the in-game outfit window and the help/settings window.
// It only builds the UI; main.js passes in what each button should do.

import { EMOTE_LIST } from '../../shared/constants.js';
import { createOutfitEditor } from './outfitEditor.js';
import { openShop } from './shop.js';
import { sfx } from '../audio/sfx.js';

export function createBottomBar({ onEmote, onTag, onChat, onOutfitSaved, onOpenWindow, onCloseWindow, getOutfitContext, onMute, getSponsor }) {
  const bar = document.createElement('div');
  bar.className = 'bottom-bar';
  bar.style.display = 'none';
  const buttons = [
    ['outfit', 'Outfit', 'O'],
    ['emotes', 'Emotes', 'T'],
    ['tag', 'Tag', 'V'],
    ['shop', 'Shop', ''],
    ['chat', 'Chat', 'Enter'],
    ['menu', 'Menu', ''],
  ];
  for (const [id, label, key] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = id;
    b.innerHTML = `<span class="txt">${label}</span>${key ? `<span class="key">${key}</span>` : ''}`;
    bar.appendChild(b);
  }
  const tagBadge = document.createElement('span');
  tagBadge.className = 'badge';
  bar.querySelector('[data-id=tag]').appendChild(tagBadge);
  document.body.appendChild(bar);

  // ---------------------------------------------------------- emote picker
  const picker = document.createElement('div');
  picker.className = 'emote-picker';
  picker.style.display = 'none';
  EMOTE_LIST.forEach((e, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<b>${i + 1}</b> ${e.label}`;
    b.addEventListener('click', () => { closePicker(); onEmote(i); });
    picker.appendChild(b);
  });
  document.body.appendChild(picker);
  const openPicker = () => { picker.style.display = 'grid'; onOpenWindow(); };
  const closePicker = () => { if (picker.style.display !== 'none') { picker.style.display = 'none'; onCloseWindow(); } };
  window.addEventListener('keydown', (e) => {
    if (picker.style.display === 'none') return;
    const n = Number(e.key);
    const pick = n >= 1 && n <= EMOTE_LIST.length;
    const close = e.key === 'Escape' || e.key === 't' || e.key === 'T';
    if (!pick && !close) return;
    // The picker used this key: keep it away from the game, or the same press would also
    // send a chant (1-4) or open the picker again (T) on the next frame.
    e.preventDefault();
    e.stopPropagation();
    closePicker();
    if (pick) onEmote(n - 1);
  }, true);

  // ---------------------------------------------------------- modal windows
  let modal = null;
  function openModal(build) {
    closeModal();
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    const card = document.createElement('div');
    card.className = 'modal-card';
    modal.appendChild(card);
    const cleanup = build(card) || (() => {});
    modal.cleanup = cleanup;
    modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    window.addEventListener('keydown', onModalKey, true);
    onOpenWindow();
  }
  // Esc closes the window (like the shop). Nothing is saved: same as Cancel.
  function onModalKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeModal();
  }
  function closeModal() {
    if (!modal) return;
    window.removeEventListener('keydown', onModalKey, true);
    modal.cleanup();
    modal.remove();
    modal = null;
    onCloseWindow();
  }

  function openOutfit() {
    const { faction, look, slogan } = getOutfitContext();
    openModal((card) => {
      card.innerHTML = '<h2>Your outfit</h2>';
      let current = look;
      const editor = createOutfitEditor({ faction, look, slogan, onChange: (l) => { current = l; } });
      card.appendChild(editor.element);
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      actions.innerHTML = '<button type="button" class="secondary">Cancel</button><button type="button">Save</button>';
      actions.children[0].addEventListener('click', closeModal);
      actions.children[1].addEventListener('click', () => { onOutfitSaved(current); closeModal(); });
      card.appendChild(actions);
      return () => editor.destroy();
    });
  }

  function openMenu() {
    openModal((card) => {
      const low = new URLSearchParams(location.search).get('quality') === 'low';
      card.innerHTML = `
        <h2>Menu</h2>
        <table class="controls">
          <tr><td>Look around</td><td>move the mouse (Esc frees it)</td></tr>
          <tr><td>Move · run · jump</td><td>WASD · hold Shift · Space</td></tr>
          <tr><td>Hit · block</td><td>click or F · right mouse or Q</td></tr>
          <tr><td>Dodge roll</td><td>C</td></tr>
          <tr><td>Grab / throw bins</td><td>G</td></tr>
          <tr><td>Role ability</td><td>R (medic, journalist, drummer)</td></tr>
          <tr><td>Water cannon (police)</td><td>E in / out · hold click or Space: water · V: view</td></tr>
          <tr><td>Tear gas</td><td>H: throw (police) · G: throw it back (protesters)</td></tr>
          <tr><td>Ice-cream van</td><td>E</td></tr>
          <tr><td>Emotes · tag · chat</td><td>T · V · Enter</td></tr>
          <tr><td>Chants · missions</td><td>1–4 · P</td></tr>
          <tr><td>Mute · zoom</td><td>M · mouse wheel</td></tr>
        </table>
        <div class="sound-box">
          <b>Sound</b>
          <label><input type="checkbox" data-s="on" /> Sound on (M)</label>
          <label>Volume <input type="range" data-s="vol" min="0" max="100" /></label>
          <label><input type="checkbox" data-s="amb" /> Ambient sounds (helicopter, sirens, rain)</label>
        </div>
        <div class="sponsor"></div>
        <div class="modal-actions">
          <button type="button" class="secondary" data-a="quality">${low ? 'High quality' : 'Low quality (faster)'}</button>
          <button type="button" data-a="close">Back to the game</button>
        </div>`;
      // Today's sponsor (from the banner on the south building), or how to advertise.
      const sp = card.querySelector('.sponsor');
      const { campaign, contact } = getSponsor?.() || {};
      if (campaign?.url) {
        sp.append('Sponsor on the square: ');
        const a = document.createElement('a');
        a.href = campaign.url; a.target = '_blank'; a.rel = 'noopener sponsored';
        a.textContent = campaign.title || campaign.url;
        sp.append(a);
      } else {
        sp.textContent = contact ? `Want your brand on the big wall? Contact: ${contact}` : 'Want your brand on the big wall? Ask the game owner.';
      }
      const snd = sfx.settings;
      const on = card.querySelector('[data-s=on]'), vol = card.querySelector('[data-s=vol]'), amb = card.querySelector('[data-s=amb]');
      on.checked = !snd.muted; vol.value = Math.round(snd.volume * 100); amb.checked = snd.ambient;
      on.addEventListener('change', () => { sfx.setMuted(!on.checked); sfx.unlock(); });
      vol.addEventListener('input', () => { sfx.setVolume(vol.value / 100); sfx.unlock(); });
      amb.addEventListener('change', () => sfx.setAmbient(amb.checked));
      card.querySelector('[data-a=quality]').addEventListener('click', () => {
        const u = new URL(location.href);
        if (low) u.searchParams.delete('quality'); else u.searchParams.set('quality', 'low');
        location.href = u.toString();
      });
      card.querySelector('[data-a=close]').addEventListener('click', closeModal);
    });
  }

  bar.addEventListener('click', (e) => {
    const id = e.target.closest('button')?.dataset.id;
    if (id === 'outfit') openOutfit();
    if (id === 'shop') { const ctx = getOutfitContext(); openShop({ faction: ctx.faction, look: ctx.look, slogan: ctx.slogan, onOpen: onOpenWindow, onClose: onCloseWindow }); }
    if (id === 'emotes') (picker.style.display === 'none' ? openPicker() : closePicker());
    if (id === 'tag') onTag();
    if (id === 'chat') onChat();
    if (id === 'menu') openMenu();
  });

  return {
    show() { bar.style.display = 'flex'; },
    openPicker,
    openOutfit,
    get windowOpen() { return !!modal || picker.style.display !== 'none'; },
    setTagsLeft(n) { tagBadge.textContent = String(n); tagBadge.classList.toggle('empty', n <= 0); },
  };
}
