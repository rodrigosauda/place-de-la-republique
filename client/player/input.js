// client/player/input.js
// Keyboard + mouse (+ touch buttons) state.
// Ask it "is W held?" (held) or "was E just pressed?" (pressed).

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  constructor() {
    this.down = new Set();        // keys held right now
    this.justPressed = new Set(); // keys pressed since the last frame
    this.mouseLeft = false;
    this.mouseRight = false;
    this.virtual = { forward: 0, right: 0 }; // touch joystick (-1..1)
    this.enabled = true;          // false while typing in the chat box

    window.addEventListener('keydown', (e) => {
      // Don't steal keys while the player types in a text field (menu, chat).
      if (e.target instanceof HTMLInputElement) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault(); // stop arrows/space from scrolling
      if (!this.down.has(e.code)) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    // Mouse buttons (only on the game canvas, so clicking UI doesn't count).
    window.addEventListener('pointerdown', (e) => {
      if (e.target.tagName !== 'CANVAS' || e.pointerType === 'touch') return;
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) this.mouseRight = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    // Releasing everything when the tab loses focus avoids "stuck" movement.
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseLeft = this.mouseRight = false;
    });
  }

  held(code) {
    return this.enabled && this.down.has(code);
  }

  // true only once per key press
  pressed(code) {
    const was = this.justPressed.has(code);
    this.justPressed.delete(code);
    return this.enabled && was;
  }

  // Touch buttons call these to act like a key.
  press(code) { this.justPressed.add(code); this.down.add(code); }
  release(code) { this.down.delete(code); }

  // Call at the end of each frame so old presses don't pile up.
  endFrame() {
    this.justPressed.clear();
  }

  // -1..1 values, used by both walking and driving.
  get forward() {
    const keys = (this.held('KeyW') || this.held('ArrowUp') ? 1 : 0) - (this.held('KeyS') || this.held('ArrowDown') ? 1 : 0);
    return keys || this.virtual.forward;
  }
  get right() {
    const keys = (this.held('KeyD') || this.held('ArrowRight') ? 1 : 0) - (this.held('KeyA') || this.held('ArrowLeft') ? 1 : 0);
    return keys || this.virtual.right;
  }
  // Hold Shift to run.
  get run() {
    return this.held('ShiftLeft') || this.held('ShiftRight') || this.down.has('TouchRun');
  }
  get jump() {
    return this.held('Space');
  }
  // Block: right mouse button (or Q, or the touch button). CRS use their shield.
  get block() {
    return this.enabled && (this.mouseRight || this.down.has('KeyQ') || this.down.has('TouchBlock'));
  }
  // Water cannon while driving: hold left mouse or Space (or the touch button)
  get spray() {
    return this.enabled && (this.mouseLeft || this.down.has('Space') || this.down.has('TouchBlock'));
  }
}
