// client/ui/tutorial.js
// A short first-minute guide: move, reach the goal, hit, block, chant (and your role's ability).
// It shows once (remembered in the profile). K skips it. Replay it with ?tutorial=1.

import { ROLES } from '../../shared/constants.js';

export function createTutorial({ isTouch, role = '', faction = 'g' }) {
  const panel = document.createElement('div');
  panel.className = 'tutorial';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  const hit = isTouch ? 'the Hit button' : 'left click (or F)';
  const block = isTouch ? 'the Block button' : 'the right mouse button (or Q)';
  const steps = [
    { id: 'move', text: isTouch ? 'Move with the joystick, drag the view to look around.' : 'Move with W A S D, look around with the mouse. Hold Shift to run.' },
    { id: 'goal', text: 'Reach the glowing ring: that is the goal of the day. The minimap arrow shows the way.' },
    { id: 'hit', text: `Hit someone with ${hit}. Three hits knock a person out. But careful: violence costs public opinion.` },
    { id: 'block', text: `Hold ${block} to block a hit.` },
    { id: 'chant', text: faction === 'g'
      ? 'Press 1 to chant. Chanting together raises public opinion: watch the bar under the clock.'
      : 'Press 1 to give an order. Keep order without violence: public opinion decides who wins.' },
  ];
  if (ROLES[role]) steps.push({ id: 'ability', text: `You are a ${ROLES[role].label}. ${ROLES[role].blurb}` });

  let i = -1;
  let doneAt = 0;
  let stepStart = 0;
  let start = null; // where you stood when the tutorial began
  let finished = true;

  function render() {
    if (finished) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const s = steps[i];
    panel.innerHTML = '';
    if (!s) {
      panel.classList.add('last');
      panel.innerHTML = '<b>You are ready.</b> Keep the public with you, and have fun. Esc frees the mouse, M mutes the sound.';
      return;
    }
    panel.classList.remove('last');
    const head = document.createElement('div');
    head.className = 'tut-head';
    head.textContent = `First steps ${i + 1}/${steps.length}`;
    const skip = document.createElement('span');
    skip.className = 'tut-skip';
    skip.textContent = isTouch ? 'tap to skip' : 'K: skip';
    skip.onclick = () => api.skip();
    head.append(skip);
    const text = document.createElement('div');
    text.textContent = s.text;
    panel.append(head, text);
  }

  const api = {
    get active() { return !finished; },
    begin(position, onFinish) {
      finished = false;
      i = 0;
      stepStart = performance.now();
      start = position.clone();
      this.onFinish = onFinish;
      render();
    },
    skip() {
      if (finished) return;
      finished = true;
      render();
      this.onFinish?.();
    },
    // Something happened in the game: 'hit', 'block', 'chant', 'ability'.
    notify(kind) {
      if (finished || steps[i]?.id !== kind) return;
      this.advance();
    },
    advance() {
      i += 1;
      stepStart = performance.now();
      render();
      if (i >= steps.length) doneAt = performance.now() + 6000;
    },
    // Every frame. position = yours; goal = { x, z, r } of the objective (or null).
    update(position, goal) {
      if (finished) return;
      const now = performance.now();
      if (i >= steps.length) {
        if (now > doneAt) { finished = true; render(); this.onFinish?.(); }
        return;
      }
      const id = steps[i].id;
      if (id === 'move' && position.distanceTo(start) > 8) this.advance();
      else if (id === 'goal') {
        const ring = !!goal && !goal.plaza;
        if (steps[i].mode !== ring) { // early morning: no goal yet, so send them to the monument
          steps[i].mode = ring;
          steps[i].text = ring ? 'Reach the glowing ring: that is the goal of the day. The minimap arrow shows the way.'
            : 'Walk to the monument in the middle of the square. Later in the day the goal shows up as a glowing ring.';
          render();
        }
        const g = ring ? goal : { x: 0, z: 0, r: 8 };
        if (Math.hypot(position.x - g.x, position.z - g.z) < g.r + 6 || now - stepStart > 30000) this.advance();
      }
    },
  };
  return api;
}
