// client/quality.js
// Graphics quality. Add ?quality=low to the URL on slow computers:
// lower resolution, no shadows, fewer façade details. Gameplay is identical.
export const LOW_QUALITY = new URLSearchParams(location.search).get('quality') === 'low';

// Phone / tablet (a finger is the main pointer) or computer (mouse or trackpad)?
// A laptop that also has a touch screen is a computer: it keeps the mouse look and click-to-hit,
// and gets no on-screen joystick. So "has touch" alone is not enough; the main pointer decides.
const HAS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const MOUSE_FIRST = !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
export const IS_TOUCH = HAS_TOUCH && !MOUSE_FIRST;
