// client/ui/touchControls.js
// On phones / tablets: a joystick (bottom left) and buttons (bottom right).
// They just feed the same Input object as the keyboard, so the game code
// doesn't care where the input came from. Drag on the 3D view to look around.

export function setupTouchControls(input, { onChat }) {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return { setFaction() {} };

  const root = document.createElement('div');
  root.className = 'touch-ui';
  root.innerHTML = `
    <div class="joy"><div class="knob"></div></div>
    <div class="touch-buttons">
      <button data-key="KeyF">Hit</button>
      <button data-key="Space">Jump</button>
      <button data-key="KeyE">Truck</button>
      <button data-key="TouchBlock">Block / Spray</button>
      <button data-key="KeyG">Grab / Throw</button>
      <button data-key="TouchRun">Run</button>
      <button data-key="KeyC">Dash</button>
      <button data-key="KeyH" data-police hidden>Tear gas</button>
      <button data-chat>Chat</button>
    </div>`;
  document.body.appendChild(root);

  // --- joystick ---
  const joy = root.querySelector('.joy');
  const knob = root.querySelector('.knob');
  const R = 50; // max knob travel in px
  let id = null, cx = 0, cy = 0;
  joy.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    const r = joy.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    joy.setPointerCapture(id);
    move(e);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = '';
    input.virtual.forward = input.virtual.right = 0;
  };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
  function move(e) {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.virtual.right = dx / R;
    input.virtual.forward = -dy / R;
  }

  // --- buttons ---
  for (const btn of root.querySelectorAll('button')) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (btn.dataset.chat !== undefined) return onChat();
      input.press(btn.dataset.key);
    });
    const up = () => btn.dataset.key && input.release(btn.dataset.key);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  // The tear-gas button is only for the police.
  return {
    setFaction(faction) {
      for (const b of root.querySelectorAll('[data-police]')) b.hidden = faction !== 'c';
    },
  };
}
