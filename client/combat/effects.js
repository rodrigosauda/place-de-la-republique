// client/combat/effects.js
// Purely visual character animation (no game logic here):
//   - walking (legs + arms swing), old people walk a bit stiffer
//   - weapon swing (the right arm winds up and smashes down)
//   - blocking (CRS: shield in front; others: arms up to guard)
//   - carrying a bin/barrier above the head, holding the placard up
//   - red flash when hit, falling over + spinning stars when knocked out
//   - emotes: wave, hands up, clap, dance, sit
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
    this.koBlend = 0;      // 0 = standing, 1 = lying on the ground
    this.koT = 0;          // seconds since the K.O. (the fall is a short animation, not a slide)
    this.koSide = 1;       // which side you fall to (+1 / -1)
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
    if (ko && !this.ko) { this.koT = 0; this.koSide = Math.random() < 0.5 ? -1 : 1; }
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
    const running = speed > 7.5;
    this.walkPhase += dt * speed * 2.85 * (p.old ? 1.2 : 1);
    const s = Math.sin(this.walkPhase);
    const stride = s * (running ? 0.75 : 0.5) * moving * (p.old ? 0.6 : 1);

    // Target angles: [rightArm.x, rightArm.z, leftArm.x, leftArm.z, legR.x, legL.x]
    // Arms swing opposite to the legs, a bit away from the body; running pumps them (bent forward).
    const armSwing = running ? 0.9 : 0.45;
    let ra = ARM_REST - stride * armSwing - (running ? 0.35 : 0), raz = 0.07;
    let la = ARM_REST + stride * armSwing - (running ? 0.35 : 0), laz = -0.07;
    let lr = stride, ll = -stride;
    let poseY = 0, poseYaw = 0;
    // A little bounce on every step, a lean forward when running, the shoulders turning with the steps.
    const bob = Math.abs(Math.cos(this.walkPhase)) * (running ? 0.06 : 0.035) * moving;
    const lean = (running ? 0.16 : 0.05) * moving;
    const twist = s * (running ? 0.12 : 0.08) * moving;

    if (p.placard && !this.carrying) la = -2.9;                 // sign held high
    if (this.blocking && !this.ko) {
      if (p.shield) { la = -1.25; }                            // CRS: shield arm forward
      else { ra = -1.8; raz = 0.5; la = -1.8; laz = -0.5; }     // guard with both arms
    }
    if (this.carrying) { ra = -2.95; la = -2.95; raz = 0.25; laz = -0.25; } // bin above the head

    switch (emote) {
      case 'wave': ra = -2.7; raz = Math.sin(this.time * 10) * 0.4; break;
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

    // --- KO: stagger, fall over sideways (like gravity, with a small bounce), lie limp ----
    // Getting up again is a quick push back up.
    if (this.ko) {
      this.koT += dt;
      const t = this.koT;
      // 0-0.18 s stagger back; 0.18-0.55 s fall (accelerating); then a bounce and rest.
      if (t < 0.18) this.koBlend = 0.08 * (t / 0.18);
      else if (t < 0.55) { const u = (t - 0.18) / 0.37; this.koBlend = 0.08 + 0.92 * u * u; }
      else if (t < 0.75) this.koBlend = 1 - Math.sin(((t - 0.55) / 0.2) * Math.PI) * 0.06;
      else this.koBlend = 1;
      // Limp arms and legs while down.
      if (t > 0.18) { ra = -0.4; raz = 0.9; la = -0.2; laz = -1.1; lr = 0.25; ll = -0.35; }
      else { ra = -2.4; la = -2.4; raz = 0.5; laz = -0.5; } // arms fly up as you get hit
    } else {
      this.koBlend += (0 - this.koBlend) * (1 - Math.exp(-7 * dt));
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

    const kb = this.koBlend, standing = 1 - kb;
    p.pose.rotation.z = this.koSide * (Math.PI / 2) * kb;
    p.pose.rotation.x = lean * standing - 0.15 * kb;
    p.pose.rotation.y += (poseYaw - p.pose.rotation.y) * k;
    p.pose.position.y = -0.72 * kb + (poseY + bob) * standing;
    if (p.torso) p.torso.rotation.y = twist * standing;
    if (p.stars.visible) {
      p.stars.position.set(-this.koSide * 0.85, -0.45, 0);
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
