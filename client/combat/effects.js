// client/combat/effects.js
// Purely visual character animation (no game logic here):
//   - walking (legs + arms swing), old people walk a bit stiffer
//   - weapon swing (the right arm winds up and smashes down)
//   - blocking (CRS: shield in front; others: arms up to guard)
//   - carrying a bin/barrier above the head, holding the placard up
//   - red flash when hit, falling over + spinning stars when knocked out
//   - emotes: wave, raised fist, hands up, clap, dance, sit
//   - chat bubbles and floating "BONK!" text
// Works on any mesh made by createPlayerMesh (local, remote, NPC, menu preview).

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ARM_REST } from '../player/playerMesh.js';
import { EMOTE_LIST } from '../../shared/constants.js';

const SWING_TIME = 0.35;   // seconds for a full swing
const FLASH_TIME = 0.18;   // seconds the body glows red after a hit

export class CharacterFx {
  constructor(mesh) {
    this.parts = mesh.userData.parts;
    this.swingT = -1;      // < 0 = not swinging
    this.flashT = 0;
    this.ko = false;
    this.koBlend = 0;      // 0 = standing, 1 = lying flat
    this.blocking = false;
    this.blockBlend = 0;
    this.carrying = false;
    this.weapon = -1;
    this.walkPhase = 0;
    this.emote = -1;       // index in EMOTE_LIST, -1 = none
    this.emoteT = 0;
    this.bubbleTimer = null;
    this.time = Math.random() * 10;
  }

  // ------------------------------------------------------------ state setters
  setWeapon(i) {
    this.weapon = i;
    this.parts.weapons.forEach((w, k) => { if (w) w.visible = k === i && !this.carrying; });
  }

  setCarrying(on) {
    this.carrying = on;
    this.setWeapon(this.weapon);
    if (this.parts.placard) this.parts.placard.visible = !on;
  }

  setBlock(on) { this.blocking = on; }
  swing() { this.swingT = 0; this.emote = -1; }
  flash() { this.flashT = FLASH_TIME; }

  setKO(ko) {
    this.ko = ko;
    this.parts.stars.visible = ko;
    if (ko) this.emote = -1;
  }

  playEmote(i) {
    if (i < 0 || i >= EMOTE_LIST.length || this.ko) return;
    this.emote = i;
    this.emoteT = 0;
  }

  // Show a speech bubble for a few seconds.
  say(text) {
    const bubble = this.parts.bubble;
    bubble.element.textContent = text;
    bubble.visible = true;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => { bubble.visible = false; }, 4000);
  }

  // ----------------------------------------------------------------- per frame
  // `speed` = how fast the character moves on the ground (m/s), for the walk cycle.
  update(dt, speed = 0) {
    const p = this.parts;
    this.time += dt;
    const k = 1 - Math.exp(-14 * dt); // smoothing towards target angles

    // Emotes stop when you start walking (or after their duration).
    if (this.emote >= 0) {
      this.emoteT += dt;
      const e = EMOTE_LIST[this.emote];
      if (speed > 0.6 || (e.sec && this.emoteT > e.sec)) this.emote = -1;
    }
    const emote = this.emote >= 0 ? EMOTE_LIST[this.emote].id : null;

    // --- walk cycle ----------------------------------------------------------
    // Legs move in step with the ground covered (one full stride ≈ 2.2 m), so feet don't slide.
    const moving = Math.min(speed / 2, 1);
    this.walkPhase += dt * speed * 2.85 * (p.old ? 1.2 : 1);
    const stride = Math.sin(this.walkPhase) * (speed > 7.5 ? 0.85 : 0.65) * moving * (p.old ? 0.6 : 1);

    // Target angles: [rightArm.x, rightArm.z, leftArm.x, leftArm.z, legR.x, legL.x]
    let ra = ARM_REST - stride * 0.6, raz = 0;
    let la = ARM_REST + stride * 0.6, laz = 0;
    let lr = stride, ll = -stride;
    let poseY = 0, poseYaw = 0;

    if (p.placard && !this.carrying) la = -2.9;                 // sign held high
    if (this.blocking && !this.ko) {
      if (p.shield) { la = -1.25; }                            // CRS: shield arm forward
      else { ra = -1.8; raz = 0.5; la = -1.8; laz = -0.5; }     // guard with both arms
    }
    if (this.carrying) { ra = -2.95; la = -2.95; raz = 0.25; laz = -0.25; } // bin above the head

    switch (emote) {
      case 'wave': ra = -2.7; raz = Math.sin(this.time * 10) * 0.4; break;
      case 'fist': ra = -3.05; raz = 0.1; break;
      case 'handsup': ra = -2.9; la = -2.9; raz = 0.35; laz = -0.35; break;
      case 'clap': {
        const c = Math.sin(this.time * 14) * 0.35;
        ra = -1.35; la = -1.35; raz = 0.35 + c; laz = -0.35 - c;
        break;
      }
      case 'dance': {
        const t = this.time * 7;
        ra = -1.6 + Math.sin(t) * 1.2; la = -1.6 - Math.sin(t) * 1.2;
        raz = 0.4; laz = -0.4;
        lr = Math.sin(t) * 0.5; ll = -Math.sin(t) * 0.5;
        poseY = Math.abs(Math.sin(t)) * 0.08;
        poseYaw = Math.sin(t * 0.5) * 0.5;
        break;
      }
      case 'sit': lr = -1.5; ll = -1.5; ra = -0.6; la = -0.6; poseY = -0.42; break;
      default:
    }

    // --- weapon swing (right arm): wind up over the head, smash, come back -----
    if (this.swingT >= 0) {
      this.swingT += dt;
      const t = this.swingT / SWING_TIME;
      if (t < 0.3) ra = lerp(ARM_REST, -3.0, t / 0.3);
      else if (t < 0.55) ra = lerp(-3.0, -0.5, (t - 0.3) / 0.25);
      else if (t < 1) ra = lerp(-0.5, ARM_REST, (t - 0.55) / 0.45);
      else this.swingT = -1;
      raz = 0;
      p.arms[0].rotation.x = ra; // swings are fast: no smoothing
    } else {
      p.arms[0].rotation.x += (ra - p.arms[0].rotation.x) * k;
    }
    p.arms[0].rotation.z += (raz - p.arms[0].rotation.z) * k;
    p.arms[1].rotation.x += (la - p.arms[1].rotation.x) * k;
    p.arms[1].rotation.z += (laz - p.arms[1].rotation.z) * k;
    p.legs[0].rotation.x += (lr - p.legs[0].rotation.x) * k;
    p.legs[1].rotation.x += (ll - p.legs[1].rotation.x) * k;

    // --- red flash -----------------------------------------------------------
    if (this.flashT > 0) {
      this.flashT -= dt;
      p.bodyMaterial.emissive.setRGB(Math.max(0, this.flashT / FLASH_TIME) * 0.9, 0, 0);
    }

    // --- KO: fall on your back, stars spin above your head --------------------
    this.koBlend += ((this.ko ? 1 : 0) - this.koBlend) * (1 - Math.exp(-10 * dt));
    p.pose.rotation.x = (-Math.PI / 2) * this.koBlend;
    p.pose.rotation.y += (poseYaw - p.pose.rotation.y) * k;
    p.pose.position.y = -0.5 * this.koBlend + poseY * (1 - this.koBlend);
    if (p.stars.visible) {
      p.stars.position.set(0, -0.2, -0.9);
      p.stars.rotation.y += dt * 4;
    }

    // --- CRS shield: slide from the arm to the front of the body --------------
    if (p.shield) {
      this.blockBlend += ((this.blocking ? 1 : 0) - this.blockBlend) * (1 - Math.exp(-15 * dt));
      const b = this.blockBlend;
      p.shield.position.set(lerp(0.42, 0.05, b), lerp(0.05, 0.25, b), lerp(0.3, 0.6, b));
      p.shield.visible = !this.carrying;
    }
  }
}

// Floating "BONK!" text that rises and fades (CSS animation in style.css).
export function showBonk(scene, position, text = 'BONK!') {
  const div = document.createElement('div');
  div.className = 'bonk' + (text.startsWith('K.O') || text === 'BOOM!' ? ' big' : '');
  div.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 24)}deg`); // every word is tilted a little differently
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.set(position.x, position.y + 1.4, position.z);
  scene.add(label);
  setTimeout(() => {
    scene.remove(label);
    div.remove();
  }, 800);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
