// client/scene/adBanner.js
// A big advertising wrap ("bâche publicitaire") on the building south of the
// square, like the printed covers on Paris buildings under renovation.
//
// HOW TO SELL IT (no code needed):
//   1. Put the advertiser's image in public/ads/ (JPG or PNG, 16:9, e.g. 1600x900).
//   2. Add a campaign to public/ads/ads.json (id, title, image, url, start, end).
//   3. npm run deploy
// Several active campaigns rotate every 30 seconds. With no campaign, the
// wall shows "YOUR AD HERE". The game counts how many players saw each
// campaign (open /stats): that's the number you show the advertiser.

import * as THREE from 'three';

const W = 16, H = 9;                                // metres
// On the long south facade (Café République block), facing the square. Chosen by a line-of-sight check
// against the real tree positions: from about 70% of the square you can see it, while the old spot at
// x = -51 was hidden behind the plane trees from everywhere. Keep it low on the wall (its top stays under
// the cornice at about 20 m). The big screen (bigScreen.js) is on the same wall to the RIGHT (x 26-41),
// so the banner sits on the left part (x 4.5-20.5) and the two never overlap.
const WALL_OFFSET = 0.8;                               // metres in front of the wall (brackets bridge the gap)
const POSITION = new THREE.Vector3(12.5, 10.5, 57.9 + (12.5 - 19.7) * -0.0475 - WALL_OFFSET);
const FACING = new THREE.Vector3(-0.0475, 0, -1).normalize(); // the banner faces the square (north)
const ROTATE_MS = 30000;
const SEEN_AFTER_S = 2;                             // on screen for 2 s = 1 impression

export function createAdBanner(scene, { onSeen }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const group = new THREE.Group();
  group.position.copy(POSITION);
  group.rotation.y = Math.atan2(FACING.x, FACING.z);
  // The printed wrap (unlit-looking so it stays readable day and night).
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: texture, color: 0xd8d8d8 }));
  group.add(banner);
  // Metal frame + two lamps on arms lighting it.
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
  for (const [x, y, w, h] of [[0, H / 2 + 0.1, W + 0.4, 0.2], [0, -H / 2 - 0.1, W + 0.4, 0.2], [W / 2 + 0.1, 0, 0.2, H + 0.4], [-W / 2 - 0.1, 0, 0.2, H + 0.4]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), metal);
    bar.position.set(x, y, 0.02);
    group.add(bar);
  }
  for (const x of [-W / 4, W / 4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), metal);
    arm.position.set(x, H / 2 + 0.3, 0.6);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), metal);
    lamp.position.set(x, H / 2 + 0.25, 1.2);
    group.add(arm, lamp);
  }
  // Brackets holding the wrap off the wall (local -z is towards the wall).
  for (const x of [-W / 2, 0, W / 2]) for (const y of [-H / 2, H / 2]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, WALL_OFFSET + 0.1), metal);
    bracket.position.set(x, y, -WALL_OFFSET / 2);
    group.add(bracket);
  }
  scene.add(group);

  let campaigns = [];
  let contact = '';
  let current = null;
  let index = 0;
  const images = new Map();
  const seen = new Set();
  let visibleFor = 0;

  // ---- drawing ----
  function drawPlaceholder() {
    const grad = g.createLinearGradient(0, 0, 1600, 900);
    grad.addColorStop(0, '#0f1f3d');
    grad.addColorStop(1, '#2b4ea2');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 900);
    g.fillStyle = '#f7d417';
    g.font = '900 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('YOUR AD HERE', 800, 400);
    g.fillStyle = '#ffffff';
    g.font = '600 56px system-ui, sans-serif';
    g.fillText('Every player on the square sees this wall', 800, 520);
    g.font = '500 44px system-ui, sans-serif';
    g.fillText(contact ? `Advertise: ${contact}` : 'Advertise here — see Menu', 800, 620);
    tag();
  }
  function drawImage(img) {
    // cover-fit the image into 16:9
    const s = Math.max(1600 / img.width, 900 / img.height);
    const w = img.width * s, h = img.height * s;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 1600, 900);
    g.drawImage(img, (1600 - w) / 2, (900 - h) / 2, w, h);
    tag();
  }
  // Ads must be recognisable as ads (EU consumer rules): small "ADVERTISEMENT" tag.
  function tag() {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(1600 - 330, 900 - 64, 330, 64);
    g.fillStyle = '#fff';
    g.font = '700 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('ADVERTISEMENT', 1600 - 165, 900 - 20);
    texture.needsUpdate = true;
  }

  function show(c) {
    current = c;
    visibleFor = 0;
    if (!c) return drawPlaceholder();
    const img = images.get(c.id);
    if (img?.complete && img.naturalWidth) drawImage(img);
    else drawPlaceholder();
  }

  function activeCampaigns() {
    const today = new Date().toISOString().slice(0, 10);
    return campaigns.filter((c) => (!c.start || c.start <= today) && (!c.end || today <= c.end));
  }

  // ---- load the campaign list ----
  drawPlaceholder();
  fetch('/ads/ads.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { campaigns: [] }))
    .then((data) => {
      contact = data.contact || '';
      campaigns = (data.campaigns || []).filter((c) => c && c.id && c.image);
      for (const c of campaigns) {
        const img = new Image();
        img.onload = () => { if (current?.id === c.id) drawImage(img); };
        img.src = c.image; // must be in public/ads (same site), so it can be drawn
        images.set(c.id, img);
      }
      const list = activeCampaigns();
      show(list[0] || null);
    })
    .catch(() => drawPlaceholder());

  setInterval(() => {
    const list = activeCampaigns();
    if (list.length > 1) show(list[++index % list.length]);
  }, ROTATE_MS);

  // ---- impressions: count when the banner is on screen for a moment ----
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const toCam = new THREE.Vector3();
  return {
    get current() { return current; },
    get contact() { return contact; },
    update(dt, camera) {
      if (!current || seen.has(current.id)) return;
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(m);
      toCam.subVectors(camera.position, POSITION);
      const onScreen = frustum.containsPoint(POSITION) && toCam.dot(FACING) > 0 && toCam.length() < 130;
      visibleFor = onScreen ? visibleFor + dt : 0;
      if (visibleFor >= SEEN_AFTER_S) {
        seen.add(current.id);
        onSeen(current.id);
      }
    },
  };
}
