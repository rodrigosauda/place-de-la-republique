// client/player/RemotePlayer.js
// Another player in the room. We never simulate them: we only draw them
// at interpolated positions coming from the server snapshots.
// They DO get a kinematic capsule collider, so you bump into each other
// (and the truck bumps into them).

import { createPlayerMesh, PLAYER_RADIUS, PLAYER_HALF_LENGTH } from './playerMesh.js';
import { InterpolationBuffer } from '../network/interpolation.js';
import { CharacterFx } from '../combat/effects.js';
import { MAX_HP } from '../../shared/constants.js';

// If a player moves more than this between two snapshots, it was a teleport
// (respawn, reconnect): jump there instead of sliding across the map.
const TELEPORT_DISTANCE = 8;

export class RemotePlayer {
  constructor(scene, physics, id, name, faction, slogan, isNpc = false, look = null, badge = '') {
    this.badge = badge;
    this.isNpc = isNpc;
    this.slogan = slogan;
    this.lookKey = JSON.stringify(look);
    this.scene = scene;
    this.physics = physics;
    this.id = id;
    this.name = name;
    this.faction = faction;
    this.buffer = new InterpolationBuffer();
    this.inVehicle = false;
    this.hasPose = false;
    this.hp = MAX_HP;
    this.mesh = createPlayerMesh(name, faction, false, slogan, isNpc, look, badge);
    this.mesh.visible = false; // hidden until the first snapshot arrives
    this.fx = new CharacterFx(this.mesh);
    scene.add(this.mesh);
    this._pose = {};
    this.lastX = 0;
    this.lastZ = 0;

    // Physics: a kinematic capsule that follows the drawn position.
    const { RAPIER } = physics;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HALF_LENGTH, PLAYER_RADIUS), this.body);
  }

  // A snapshot says where this player was.
  onSnapshot(time, x, y, z, r, v, hp, b, w) {
    const last = this.buffer.samples[this.buffer.samples.length - 1];
    if (last && Math.hypot(x - last.x, z - last.z) > TELEPORT_DISTANCE) {
      this.buffer.reset(time, x, y, z, r);
    } else {
      this.buffer.push(time, x, y, z, r);
    }
    this.inVehicle = v === 1;
    this.hasPose = true;
    if (hp !== undefined) this.setHp(hp);
    this.fx.setBlock(b === 1);
    if (w !== undefined && w !== this.fx.weapon) this.fx.setWeapon(w);
  }

  setHp(hp) {
    this.hp = hp;
    this.fx.setKO(hp <= 0);
  }

  // Called every frame, BEFORE physics.step().
  update(now, dt) {
    const pose = this.buffer.sample(now, this._pose);
    if (!pose) return;
    const raw = dt > 0 ? Math.hypot(pose.x - this.lastX, pose.z - this.lastZ) / dt : 0;
    // Smooth the speed (network positions arrive 10 times a second): no twitchy legs.
    this.smoothSpeed = (this.smoothSpeed || 0) + (Math.min(raw, 12) - (this.smoothSpeed || 0)) * (1 - Math.exp(-8 * dt));
    const speed = this.smoothSpeed < 0.15 ? 0 : this.smoothSpeed;
    this.lastX = pose.x;
    this.lastZ = pose.z;
    this.mesh.position.set(pose.x, pose.y, pose.z);
    this.mesh.rotation.y = pose.r;
    // Drivers are hidden: they are "inside" the truck.
    this.mesh.visible = this.hasPose && !this.inVehicle;
    // No collision while driving or lying on the ground (you can walk over KO'd players).
    const solid = this.mesh.visible && this.hp > 0;
    this.collider.setEnabled(solid);
    if (solid) this.body.setNextKinematicTranslation({ x: pose.x, y: pose.y, z: pose.z });
    this.fx.update(dt, Math.min(speed, 12));
  }

  // They changed their outfit: rebuild the mesh (keeps position and animation state).
  setLook(look) {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    const old = this.mesh;
    this.mesh = createPlayerMesh(this.name, this.faction, false, this.slogan, this.isNpc, look, this.badge);
    this.mesh.position.copy(old.position);
    this.mesh.rotation.y = old.rotation.y;
    this.mesh.visible = old.visible;
    this.scene.add(this.mesh);
    this.scene.remove(old);
    old.userData.dispose();
    const fx = new CharacterFx(this.mesh);
    fx.setWeapon(this.fx.weapon);
    fx.setCarrying(this.fx.carrying);
    fx.setKO(this.hp <= 0);
    this.fx = fx;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.userData.dispose();
    this.physics.world.removeRigidBody(this.body); // also removes its collider
  }
}
