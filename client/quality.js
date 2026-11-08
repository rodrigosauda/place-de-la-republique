// client/quality.js
// Graphics quality. Add ?quality=low to the URL on slow computers:
// lower resolution, no shadows, fewer façade details. Gameplay is identical.
export const LOW_QUALITY = new URLSearchParams(location.search).get('quality') === 'low';
