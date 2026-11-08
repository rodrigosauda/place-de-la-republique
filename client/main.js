// client/main.js
// Entry point. Wires everything together and runs the game loop.
//
// Frame order (important for physics):
//   1. read input, compute movement (player OR truck)  -> sets "next" kinematic poses
//   2. physics.step()                                  -> Rapier applies them
//   3. copy physics positions to meshes
//   4. effects, camera, day/night, HUD, render

import * as THREE from 'three';
import {
  MSG, TICK_MS, SPAWNS, VEHICLE_ENTER_DISTANCE, FACTIONS, MAX_HP, EMOTES, WEAPONS,
  GRAB_RANGE, THROW_SPEED, TAG_RANGE, EMOTE_LIST, round2, gameMinutes,
  GAS_COOLDOWN_MS, GAS_RANGE, inSafeZone, TRUCK_SPAWN, isCurfew,
} from '../shared/constants.js';
import { objectiveAt, phaseAt, newsAt } from '../shared/timeline.js';
import { createRiotScene } from './scene/riot.js';
import { buildBases } from './scene/bases.js';
import { createRiotUi } from './ui/riotUi.js';
import { LOW_QUALITY } from './quality.js';
import { Physics } from './physics/physics.js';
import { createRenderers } from './scene/renderer.js';
import { buildWorld } from './scene/world.js';
import { setupLighting } from './scene/lighting.js';
import { setupDayNight } from './scene/dayNight.js';
import { createBigScreen } from './scene/bigScreen.js';
import { mergeStaticMeshes } from './scene/mergeStatic.js';
import { ThirdPersonCamera } from './scene/camera.js';
import { Input } from './player/input.js';
import { LocalPlayer, lerpAngle } from './player/LocalPlayer.js';
import { createMinimap } from './ui/minimap.js';
import { RemotePlayer } from './player/RemotePlayer.js';
import { Truck } from './vehicle/Truck.js';
import { WaterSpray } from './vehicle/WaterSpray.js';
import { StreetProps } from './props/StreetProps.js';
import { NetClient } from './network/NetClient.js';
import { showStartMenu } from './ui/startMenu.js';
import { createHud } from './ui/hud.js';
import { createChat } from './ui/chat.js';
import { setupTouchControls } from './ui/touchControls.js';
import { showBonk } from './combat/effects.js';
import { sfx } from './audio/sfx.js';
import { createBottomBar } from './ui/bottomBar.js';
import { saveLook } from './ui/outfitEditor.js';
import { createTagLayer } from './scene/tags.js';
import { setupAtmosphere } from './scene/atmosphere.js';
import { createAdBanner } from './scene/adBanner.js';
import { lookToArray, arrayToLook, gasProtection } from '../shared/looks.js';

const FACTION_CSS = { g: '#f7d417', c: '#9fb8ff' };

async function start() {
  // ---------------------------------------------------------------- setup
  const physics = await Physics.create(); // loads Rapier's WebAssembly
  const scene = new THREE.Scene();
  const { renderer, labelRenderer } = createRenderers(document.getElementById('app'));
  const cam = new ThirdPersonCamera(renderer.domElement);
  const world = buildWorld(scene, physics);
  const lighting = setupLighting(scene);
  const atmosphere = setupAtmosphere(renderer, scene, cam.camera); // sky, HDR lighting, post-processing
  const dayNight = setupDayNight(scene, lighting, physics, world.nightMaterials, atmosphere, world.lamps);
  const bigScreen = createBigScreen(scene);
  const bases = buildBases(scene, physics); // police buses + café: where each side starts
  mergeStaticMeshes(scene); // glue the static city together = much faster rendering
  // Everything static is now merged: these are the walls you can spray tags on.
  const wallMeshes = scene.children.filter((o) => o.isMesh && !o.isInstancedMesh && (o.userData.wall || !o.userData.noMerge));
  const tagLayer = createTagLayer(scene);
  // The advertising wrap on the south building (see public/ads/README.txt).
  const adBanner = createAdBanner(scene, { onSeen: (c) => net.send({ t: MSG.AD_SEEN, c }) });
  // The living riot: crowd, police lines, tear gas, flares, helicopter, rubbish.
  const riot = createRiotScene(scene, physics, { lowQuality: LOW_QUALITY });
  riot.setObstacles(world.obstacles);
  const riotUi = createRiotUi(scene);
  const input = new Input();
  const hud = createHud();
  const minimap = createMinimap();
  // The map comes from OpenStreetMap: its licence asks for this credit on screen.
  const credit = document.createElement('a');
  credit.className = 'osm-credit';
  credit.href = 'https://www.openstreetmap.org/copyright';
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = 'Map data © OpenStreetMap contributors';
  document.body.appendChild(credit);
  const truck = new Truck(scene, physics);
  truck.setDriverName(null);
  const spray = new WaterSpray(scene);
  const props = new StreetProps(scene, physics);

  const net = new NetClient();
  const room = new URLSearchParams(location.search).get('room') || 'main';
  const remotes = new Map(); // id -> RemotePlayer
  const names = new Map();   // id -> name
  const factions = new Map(); // id -> faction
  let local = null;          // LocalPlayer, created when you press Play
  let pendingExit = false;   // we left the truck; ignore old "you own it" messages
  let status = 'menu';
  let score = { g: 0, c: 0 };
  let lastSent = '';
  let wasCurfew = null;

  // ------------------------------------------------------ chat
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const chat = createChat({
    input,
    onSend: (text) => net.send({ t: MSG.CHAT, m: text }),
    onOpen: () => cam.unlock(),                        // free the mouse while typing
    onClose: (byKey) => { if (byKey && local) cam.lock(); }, // Enter = back to the game
  });
  const touch = setupTouchControls(input, { onChat: () => chat.open() });

  // ------------------------------------------------------ truck ownership
  // The server is the boss: we only enter the truck when it says we own it.
  function setTruckOwner(ownerId) {
    if (pendingExit) {
      if (ownerId === net.myId) return; // stale message from before our exit
      pendingExit = false;
    }
    if (ownerId === truck.ownerId) return;
    const previous = truck.ownerId;
    truck.ownerId = ownerId;
    truck.setDriverName(ownerId ? names.get(ownerId) ?? '?' : null);

    if (ownerId === net.myId && local && !local.inVehicle) {
      local.enterVehicle(); // we got the keys!
      truck.resetBuffer();
      cam.distance = 15;
    } else if (previous === net.myId && local?.inVehicle) {
      exitTruck(false); // server took the truck away from us (rare)
    } else {
      truck.resetBuffer(); // someone else started/stopped driving
    }
  }

  function exitTruck(tellServer = true) {
    const spot = truck.exitPoint();
    local.exitVehicle(spot.x, spot.z, truck.yaw);
    if (tellServer) {
      const p = truck.position;
      net.send({ t: MSG.SPRAY, on: 0 });
      net.send({ t: MSG.EXIT, p: [round2(p.x), round2(p.y), round2(p.z)], r: round2(truck.yaw) });
      pendingExit = true;
    }
    truck.ownerId = 0;
    truck.spraying = false;
    truck.setDriverName(null);
    truck.resetBuffer(); // stay parked where we left it
    cam.distance = 9;
  }

  // ------------------------------------------------------ network events
  net.onStatus = (s) => { status = s; };

  // When we (re)join, tell the server where we are so we don't jump back to spawn.
  net.getJoinPose = () => {
    if (!local) return null;
    const p = local.inVehicle ? { ...truck.exitPoint(), y: 1 } : local.position;
    return { p: [round2(p.x), round2(p.y), round2(p.z)], r: round2(local.facing) };
  };

  let joinedBefore = false;
  net.onWelcome = () => {
    if (joinedBefore) {
      // RECONNECT: the server freed the truck and reset our health; match that.
      if (local.inVehicle) exitTruck(false);
      truck.ownerId = 0;
      pendingExit = false;
      if (local.isKO) local.respawn();
      local.hp = MAX_HP;
    }
    joinedBefore = true;
    lastSent = ''; // force sending our state again
  };

  net.onRoster = (list) => {
    const present = new Set();
    for (const [id, name, faction, slogan, isNpc, lookArr] of list) {
      present.add(id);
      names.set(id, name);
      factions.set(id, faction);
      if (id === net.myId) continue;
      const look = arrayToLook(lookArr);
      if (remotes.has(id)) { remotes.get(id).setLook(look); continue; } // outfit may have changed
      remotes.set(id, new RemotePlayer(scene, physics, id, name, faction, slogan, isNpc === 1, look));
    }
    for (const [id, remote] of remotes) { // remove players who left
      if (!present.has(id)) {
        remote.dispose();
        remotes.delete(id);
      }
    }
    // The truck drives through other players (the server knocks them over instead).
    truck.ignoreHandles = new Set([...remotes.values()].map((r) => r.collider.handle));
  };

  net.onSnapshot = (msg, now) => {
    for (const [id, x, y, z, r, v, hp, b, w] of msg.p) {
      if (id === net.myId) continue; // we already know where we are
      remotes.get(id)?.onSnapshot(now, x, y, z, r, v, hp, b, w);
    }
    const [x, y, z, r, owner, spraying, water] = msg.v;
    setTruckOwner(owner);
    truck.water = water ?? truck.water;
    // Only follow the server's truck when we are NOT the driver.
    if (truck.ownerId !== net.myId && !pendingExit) {
      truck.onSnapshot(now, x, y, z, r);
      truck.spraying = spraying === 1;
    }
    for (const [i, px, pz] of msg.o ?? []) props.setOne(i, px, pz);
    if (msg.l) riot.setLine(msg.l[0], msg.l[1]); // how far the police line has got
  };

  net.onVehicle = (ownerId) => setTruckOwner(ownerId);
  net.onProps = (list) => {
    props.setAll(list);
    list.forEach(([, , carrier]) => { if (carrier) remotes.get(carrier)?.fx.setCarrying(true); });
  };

  // Someone picked up (id) or dropped (0) prop i.
  function setHolderCarrying(id, on, i) {
    if (!id) return;
    if (id === net.myId) local?.setCarrying(on ? i : -1);
    else remotes.get(id)?.fx.setCarrying(on);
  }
  net.onCarry = ({ i, id }) => {
    const previous = props.items[i]?.carrier;
    if (previous) setHolderCarrying(previous, false, i);
    props.setCarrier(i, id);
    setHolderCarrying(id, true, i);
  };
  net.onFly = ({ i, p, v, by }) => {
    setHolderCarrying(props.items[i]?.carrier || by, false, i);
    props.startFlight(i, p, v);
    const from = by === net.myId ? local?.position : remotes.get(by)?.mesh.position;
    sfx.whoosh(from ? volumeAt(from) : 0.5);
  };
  // Where is the person holding a prop? (for drawing it above their head)
  const holderOf = (id) => {
    if (id === net.myId && local) return { position: local.position, facing: local.facing };
    const r = remotes.get(id);
    return r ? { position: r.mesh.position, facing: r.mesh.rotation.y } : null;
  };

  // G: pick up the nearest bin/barrier, or throw the one you carry.
  function grabOrThrow() {
    if (!local || local.inVehicle || local.isKO || !net.myId) return;
    if (local.carrying >= 0) return throwProp();
    // Protesters: a fresh tear-gas canister at your feet? Throw it back where you look.
    const can = local.faction === 'g' ? riot.canisterNear(local.position.x, local.position.z) : null;
    if (can) {
      local.facing = cam.aimYaw;
      local.fx.swing();
      const d = GAS_RANGE * 0.8;
      net.send({ t: MSG.GAS, back: can.id, p: [round2(local.position.x + Math.sin(cam.aimYaw) * d), round2(local.position.z + Math.cos(cam.aimYaw) * d)] });
      return;
    }
    const i = props.nearest(local.position, GRAB_RANGE);
    if (i >= 0) net.send({ t: MSG.GRAB, i });
  }
  function throwProp() {
    const i = local.carrying;
    local.facing = cam.aimYaw; // throw where the camera looks
    const fx = Math.sin(local.facing), fz = Math.cos(local.facing);
    const v = [round2(fx * THROW_SPEED), 3, round2(fz * THROW_SPEED)]; // fairly flat arc: hits people ~3-14 m away
    net.send({ t: MSG.THROW, i, v });
  }
  net.onScore = (s) => { score = { g: s.g, c: s.c }; };

  net.onChat = ({ id, m }) => {
    const isMe = id === net.myId;
    const who = isMe ? local : remotes.get(id);
    who?.fx.say(m);
    chat.add(names.get(id) ?? '?', m, FACTION_CSS[factions.get(id)] ?? '#fff');
    sfx.pop();
  };

  // ------------------------------------------------------ riot events
  // Tear gas from a police player: the canister flies, then the cloud appears.
  net.onGas = ({ id, p, by, rm }) => {
    if (rm) riot.removeGas(rm); // a protester picked this canister up to throw it back
    const line = riot.line;
    const from = by === 'L' ? new THREE.Vector3(line.x, 0.6, line.z)
      : by === net.myId ? local?.position : remotes.get(by)?.mesh.position;
    const land = () => { riot.addGas(p[0], p[1], Date.now(), id); sfx.gasPop(local ? volumeAt(new THREE.Vector3(p[0], 0, p[1])) : 0); };
    if (from) riot.throwGas(from.clone().setY(from.y + 1.4), p, land);
    else land();
  };
  net.onNews = (text) => riotUi.news(text);
  net.onCrowd = ({ i, k }) => {
    riot.knockDown(i, k[0], k[1]);
    const a = i >= 1000 ? riot.police[i - 1000] : riot.crowd[i];
    if (a && local) { const p = new THREE.Vector3(a.x, 1, a.z); showBonk(scene, p, 'BONK!'); sfx.bonk(volumeAt(p)); }
  };
  // New day: everything goes back to where it started (bins, truck, graffiti, you).
  net.onReset = () => {
    riot.gasClouds.length = 0;
    truck.place(TRUCK_SPAWN.x, TRUCK_SPAWN.y, TRUCK_SPAWN.z, TRUCK_SPAWN.r);
    if (!local) return;
    if (local.inVehicle) exitTruck(false);
    pendingExit = false;
    truck.ownerId = 0;
    truck.place(TRUCK_SPAWN.x, TRUCK_SPAWN.y, TRUCK_SPAWN.z, TRUCK_SPAWN.r);
    local.setCarrying(-1);
    local.respawn();
    lastSent = '';
  };
  net.onSummary = (msg) => {
    if (!local) return;
    cam.unlock();
    input.enabled = false;
    riotUi.showSummary(msg, () => { input.enabled = true; if (!isTouch) cam.lock(); });
  };

  // H (police): throw tear gas where you are looking.
  let lastGas = -GAS_COOLDOWN_MS;
  let gasHintUntil = 0;
  let safeHintUntil = 0;
  function throwGas() {
    if (!local || local.faction !== 'c' || local.inVehicle || local.isKO || !net.myId) return;
    if (inSafeZone(local.position.x, local.position.z)) { safeHintUntil = performance.now() + 2000; return; }
    const now = performance.now();
    if (now - lastGas < GAS_COOLDOWN_MS) { gasHintUntil = now + 1500; return; }
    lastGas = now;
    local.facing = cam.aimYaw;
    local.fx.swing();
    const d = GAS_RANGE * 0.8;
    const x = local.position.x + Math.sin(cam.aimYaw) * d, z = local.position.z + Math.cos(cam.aimYaw) * d;
    net.send({ t: MSG.GAS, p: [round2(x), round2(z)] });
  }

  // ------------------------------------------------------ combat events
  const volumeAt = (pos) => (local ? sfx.distanceVolume(local.position.distanceTo(pos)) : 0);

  net.onSwing = (id, msg) => {
    if (id === 'L') { // the riot-police line hit someone: an officer swings his rubber chicken
      riot.lineSwing(msg.p[0], msg.p[1]);
      return;
    }
    if (id === 'X') { // the crowd hit a police player who charged in
      riot.crowdSwing(msg.p[0], msg.p[1]);
      return;
    }
    if (id === net.myId) return;
    const remote = remotes.get(id);
    if (!remote) return;
    remote.fx.swing();
    sfx.whoosh(volumeAt(remote.mesh.position));
  };

  net.onHit = ({ id, hp, k, v: byTruck, by }) => {
    const attackerFaction = by === 'L' ? 'c' : by === 'X' ? 'g' : by === net.myId ? local?.faction : factions.get(by); // police = rubber chicken
    const text = byTruck ? 'BOOM!' : hp <= 0 ? 'K.O.!' : 'BONK!';
    const target = id === net.myId ? local : remotes.get(id);
    if (!target) return;
    const pos = id === net.myId ? local.position : target.mesh.position;
    if (id === net.myId) {
      local.onHit(hp, k[0], k[1], performance.now(), byTruck === 1);
      cam.shake(byTruck ? 0.5 : hp <= 0 ? 0.4 : 0.25); // you feel it
      hud.flashHit(byTruck ? 1 : hp <= 0 ? 0.9 : 0.6);
    } else {
      target.fx.flash();
      target.setHp(hp);
      if (by === net.myId) cam.shake(hp <= 0 ? 0.18 : 0.08); // landing a hit feels good too
    }
    showBonk(scene, pos, byTruck ? text : hp <= 0 ? text : attackerFaction === 'c' ? 'SQUEAK!' : 'CRUNCH!');
    const v = id === net.myId ? 1 : volumeAt(pos);
    if (attackerFaction === 'c') sfx.squeak(v); else sfx.bonk(v);
    if (hp <= 0) sfx.ko(v);
  };

  net.onBlocked = (id) => {
    const target = id === net.myId ? local : remotes.get(id);
    if (!target) return;
    const pos = id === net.myId ? local.position : target.mesh.position;
    showBonk(scene, pos, 'BLOCK!');
    sfx.clang(id === net.myId ? 1 : volumeAt(pos));
    if (id === net.myId) cam.shake(0.1);
  };

  let lastSplash = 0;
  net.onPush = ({ k }) => {
    local?.onPush(k[0], k[1]);
    if (performance.now() - lastSplash > 300) { lastSplash = performance.now(); sfx.splash(); }
  };

  // F key or a quick left click = swing.
  function attack() {
    if (!local || !net.myId) return;
    if (inSafeZone(local.position.x, local.position.z)) { safeHintUntil = performance.now() + 2000; return; } // no fighting in a base
    if (local.carrying >= 0) return throwProp(); // hands full: click throws the prop
    if (!local.tryAttack(performance.now(), cam.aimYaw)) return; // cooldown, KO, shield or driving
    sfx.whoosh();
    const p = local.position;
    // Did we hit one of the background extras? (players and NPCs are judged by the server)
    const extra = riot.findExtra(p.x, p.z, local.facing, WEAPONS[local.weapon].range + 0.3, local.faction);
    if (extra >= 0) net.send({ t: MSG.CROWD, i: extra, k: [round2(Math.sin(local.facing)), round2(Math.cos(local.facing))] });
    net.send({ t: MSG.ATTACK, p: [round2(p.x), round2(p.y), round2(p.z)], r: round2(local.facing) });
  }
  cam.onTap = () => { if (!local?.inVehicle) attack(); };

  // ------------------------------------------------------ emotes, tags, bottom bar
  net.onEmote = ({ id, e }) => { if (id !== net.myId) remotes.get(id)?.fx.playEmote(e); };
  net.onTag = (tag) => { tagLayer.add(tag); sfx.splash(0.4); };
  net.onTags = (list) => tagLayer.setAll(list);
  net.onTagsLeft = (n) => bar.setTagsLeft(n);

  function doEmote(i) {
    if (!local || local.inVehicle || local.isKO) return;
    local.fx.playEmote(i);
    net.send({ t: MSG.EMOTE, e: i });
  }

  // Spray your name on the wall the camera is pointing at.
  const raycaster = new THREE.Raycaster();
  const screenCentre = new THREE.Vector2(0, 0);
  let tagHintUntil = 0;
  function sprayTag() {
    if (!local || local.inVehicle || local.isKO) return;
    raycaster.setFromCamera(screenCentre, cam.camera);
    raycaster.far = 40;
    const hit = raycaster.intersectObjects(wallMeshes, false)[0];
    const n = hit?.face?.normal;
    const ok = hit && n && Math.abs(n.y) < 0.5 && hit.point.distanceTo(local.position) < TAG_RANGE && hit.point.y > 0.5;
    if (!ok) { tagHintUntil = performance.now() + 2500; return; }
    net.send({ t: MSG.TAG, p: [round2(hit.point.x), round2(hit.point.y), round2(hit.point.z)], n: [round2(n.x), round2(n.y), round2(n.z)] });
  }

  const bar = createBottomBar({
    onEmote: doEmote,
    onTag: sprayTag,
    onChat: () => chat.open(),
    onMute: () => sfx.toggleMute(),
    getSponsor: () => ({ campaign: adBanner.current, contact: adBanner.contact }),
    getOutfitContext: () => ({ faction: local.faction, look: local.look, slogan: local.slogan }),
    onOutfitSaved: (look) => {
      local.setLook(look);
      saveLook(local.faction, look);
      net.look = lookToArray(look);
      net.send({ t: MSG.LOOK, l: net.look });
    },
    // While a window is open: free the mouse and stop walking.
    onOpenWindow: () => { cam.unlock(); input.enabled = false; },
    onCloseWindow: () => { input.enabled = true; if (!isTouch) cam.lock(); },
  });

  // ------------------------------------------------------ start menu
  // Everything is built: fade out the loading screen.
  const loading = document.getElementById('loading');
  if (loading) { loading.classList.add('done'); setTimeout(() => loading.remove(), 600); }

  showStartMenu(({ name, faction, slogan, look }) => {
    sfx.unlock(); // browsers only allow sound after a click
    const s = SPAWNS[faction];
    const angle = Math.random() * Math.PI * 2;
    const spawn = { x: s.x + Math.cos(angle) * s.radius * Math.random(), z: s.z + Math.sin(angle) * s.radius * Math.random() };
    local = new LocalPlayer({ scene, physics, name, faction, slogan, look, spawn });
    net.look = lookToArray(look);
    bar.show();
    local.facing = Math.atan2(-spawn.x, -spawn.z); // face the monument
    cam.yaw = local.facing + Math.PI;
    cam.distance = 9;
    cam.snapTo(local.position);
    net.slogan = slogan;
    touch.setFaction(faction);
    net.connect(name, faction);
    // Capture the mouse: from now on, moving it turns the camera (Esc to release).
    if (!isTouch) {
      cam.lockEnabled = true;
      cam.lock();
    }
  });

  // ------------------------------------------------------ send our state
  // TICK_RATE times per second. Skips sending when nothing changed (saves quota).
  let sprayingSent = false;
  setInterval(() => {
    if (!local || !net.connected || !net.myId) return;
    const driving = local.inVehicle;
    const p = driving ? truck.position : local.position;
    const msg = {
      t: MSG.STATE,
      p: [round2(p.x), round2(p.y), round2(p.z)],
      r: round2(driving ? truck.yaw : local.facing),
      v: driving ? 1 : 0,
      b: local.blocking ? 1 : 0,
      w: local.weapon,
    };
    const json = JSON.stringify(msg);
    if (json !== lastSent) {
      lastSent = json;
      net.ws.send(json);
    }
    // Water cannon on/off (only when it changes).
    if (driving && truck.spraying !== sprayingSent) {
      sprayingSent = truck.spraying;
      net.send({ t: MSG.SPRAY, on: sprayingSent ? 1 : 0 });
    }
    // Bins / barriers we pushed.
    for (const [i, x, z] of props.takeChanges()) net.send({ t: MSG.PROP, i, p: [round2(x), round2(z)] });
  }, TICK_MS);

  // ------------------------------------------------------ game loop
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05); // clamp: avoids huge jumps after tab switch
    const now = performance.now();
    const driving = local?.inVehicle;

    if (local) handleKeys(driving);

    // KO over? Stand up at your spawn point and tell the server.
    if (local?.koUntil && now >= local.koUntil) {
      local.respawn();
      const p = local.position;
      net.send({ t: MSG.RESPAWN, p: [round2(p.x), round2(p.y), round2(p.z)] });
    }

    // 1) movement
    props.update(dt, holderOf);
    for (const remote of remotes.values()) remote.update(now, dt);
    if (driving) {
      truck.spraying = input.spray && truck.water > 1;
      truck.drive(dt, input, props);
    } else {
      if (local) local.blocking = input.block && !local.isKO && local.carrying < 0;
      local?.update(dt, input, cam.yaw, props);
      if (local?.justDashed) { local.justDashed = false; sfx.whoosh(0.7); cam.shake(0.06); }
      truck.followNetwork(now);
    }

    const others = [];
    if (local && !local.inVehicle) others.push(local.position);
    for (const r of remotes.values()) others.push(r.mesh.position);
    riot.update(dt, local?.faction, dayNight.daylight ?? 1, others);
    // Walked into the police line (or it advanced onto you)? Get pushed back in front of it.
    if (local && !driving) {
      const push = riot.keepOut(local.position, local.faction);
      if (push) local.teleport(local.position.x + push.x, local.position.y, local.position.z + push.z);
    }

    // 2) physics
    physics.step(dt);

    // 3) physics -> meshes
    local?.syncMesh();
    truck.syncMesh();

    // 4) effects, camera, light, HUD
    local?.fx.update(dt, local.speed);
    spray.update(dt, truck, truck.spraying);
    sfx.spray(truck.spraying, driving ? 1 : volumeAt(truck.position));

    if (driving) {
      // Gently swing the camera behind the truck while driving.
      if (Math.abs(truck.speed) > 1) cam.yaw = lerpAngle(cam.yaw, truck.yaw + Math.PI, 1 - Math.exp(-2 * dt));
      cam.update(dt, truck.position, 1.5);
    } else if (local) {
      cam.update(dt, local.position, 0.8);
    } else {
      // In the menu: slowly circle the monument from far away.
      cam.distance = 45;
      cam.yaw += dt * 0.1;
      cam.update(dt, tmp.set(0, 4, 0), 0);
    }
    lighting.follow(cam.target);
    updateLabels();
    const minutes = dayNight.update();
    bigScreen.update(score, minutes, [...remotes.values()].filter((r) => !r.isNpc).length + (local ? 1 : 0));
    updateHud(minutes);
    updateMinimap(minutes);
    updateRiot(dt, minutes, now);
    bases.update(now / 1000);

    if (local) adBanner.update(dt, cam.camera);
    atmosphere.render(cam.camera);
    labelRenderer.render(scene, cam.camera);
    input.endFrame();
  });

  function handleKeys(driving) {
    // E = enter / exit the truck
    if (input.pressed('KeyE')) {
      if (driving) exitTruck();
      else if (!local.isKO && local.position.distanceTo(truck.position) < VEHICLE_ENTER_DISTANCE && truck.ownerId === 0) {
        net.send({ t: MSG.ENTER }); // wait for the server's answer (MSG.VEHICLE)
      }
    }
    if (input.pressed('KeyF') && !driving) attack();
    if (input.pressed('KeyC') && !driving) local.wantDash = true; // dodge roll
    if (input.pressed('KeyG') && !driving) grabOrThrow();
    if (input.pressed('KeyT')) bar.openPicker();
    if (input.pressed('KeyO')) bar.openOutfit();
    if (input.pressed('KeyV') && !driving) sprayTag();
    if (input.pressed('KeyM')) sfx.toggleMute();
    if (input.pressed('KeyH') && !driving) throwGas();
    // 1-4 = chants / emotes
    ['Digit1', 'Digit2', 'Digit3', 'Digit4'].forEach((code, i) => {
      if (input.pressed(code)) net.send({ t: MSG.CHAT, m: EMOTES[local.faction][i] });
    });
  }

  // The round map: you, the objective, bases, truck, other players.
  function updateMinimap(minutes) {
    if (!local) { minimap.show(false); return; }
    minimap.show(true);
    const obj = objectiveAt(minutes);
    const phase = phaseAt(minutes).id;
    minimap.update({
      me: { x: local.position.x, z: local.position.z, faction: local.faction },
      yaw: cam.yaw,
      others: [...remotes.values()].filter((r) => !r.isNpc).map((r) => ({ x: r.mesh.position.x, z: r.mesh.position.z, faction: r.faction })),
      truck: { x: truck.position.x, z: truck.position.z },
      objective: obj ? obj.zone : null,
      line: ['clashes', 'curfew', 'night'].includes(phase) ? riot.line : null,
    });
  }

  function updateHud(minutes) {
    if (!local) {
      hud.setStatus(''); hud.setHint(''); hud.setPlayers([]); hud.setHealth(null); hud.setClock(null); hud.setWater(null);
      return;
    }
    const humans = [...remotes.values()].filter((r) => !r.isNpc);
    const npcCount = remotes.size - humans.length;
    const count = humans.length + 1;
    const label = FACTIONS[local.faction].label;
    const texts = {
      connecting: 'Connecting…',
      reconnecting: 'Connection lost — reconnecting…',
      connected: `${label} · room "${room}" · ${count} player${count > 1 ? 's' : ''} online`,
    };
    hud.setStatus(texts[status] ?? '');
    if (status === 'connected') {
      const list = [`• ${local.name} (you)`];
      for (const r of humans) list.push(`• ${r.name} — ${FACTIONS[r.faction].label}`);
      if (npcCount) list.push(`+ ${npcCount} NPCs (crowd & offline players)`);
      hud.setPlayers(list);
    } else hud.setPlayers([]);

    hud.setHealth(local.hp, local.isKO ? Math.ceil((local.koUntil - performance.now()) / 1000) : 0,
      local.carrying >= 0 ? 'Carrying — click to throw'
        : `${WEAPONS[local.weapon].label} · Dash [C]: ${performance.now() >= local.dashReadyAt ? 'ready' : '…'}`);
    hud.setClock(minutes, score, local.faction);
    hud.setWater(local.inVehicle ? truck.water : null);
    hud.setMouseLocked(cam.locked, !isTouch && input.enabled);

    // Siren when the curfew starts.
    const curfew = isCurfew(minutes);
    if (wasCurfew === false && curfew) sfx.siren();
    wasCurfew = curfew;

    if (local.isKO) hud.setHint('');
    else if (local.inVehicle) hud.setHint('W/S: drive · A/D: steer · hold click or Space: water · E: get out');
    else if (local.position.distanceTo(truck.position) < VEHICLE_ENTER_DISTANCE) {
      hud.setHint(truck.ownerId ? `Truck driven by ${names.get(truck.ownerId) ?? '?'}` : 'Press E to drive the water cannon');
    } else if (performance.now() < safeHintUntil) hud.setHint('Safe zone: no fighting here. Step out of the ring to fight.');
    else if (performance.now() < gasHintUntil) hud.setHint('Tear gas is reloading…');
    else if (performance.now() < tagHintUntil) hud.setHint(`Face a wall closer than ${TAG_RANGE} m to spray your tag (V)`);
    else if (local.faction === 'g' && riot.canisterNear(local.position.x, local.position.z)) hud.setHint('G: throw the tear-gas canister back!');
    else if (local.carrying >= 0) hud.setHint('Click or G: throw');
    else if (props.nearest(local.position, GRAB_RANGE) >= 0) hud.setHint('G: pick up');
    else hud.setHint('');
  }

  // Name labels: only real players within 30 m, NPC names only when right next to you,
  // never your own; the truck label only when you're close. Keeps the screen clean.
  function updateLabels() {
    const from = local ? local.position : cam.target;
    if (local) local.mesh.userData.parts.label.visible = false;
    for (const r of remotes.values()) {
      const lab = r.mesh.userData.parts?.label;
      if (!lab) continue;
      const d = r.mesh.position.distanceTo(from);
      lab.visible = r.isNpc ? d < 5 : d < 30;
    }
    truck.label.visible = truck.position.distanceTo(from) < 14 || truck.ownerId !== 0 && truck.position.distanceTo(from) < 40;
  }

  // Breaking news, today's goal, tear gas on you, crowd sounds.
  let lastNewsAt = null;
  let gasLevel = 0;
  let coughAt = 0;
  function updateRiot(dt, minutes, now) {
    riotUi.update(now);
    const headline = newsAt(minutes);
    if (local && headline.at !== lastNewsAt) {
      lastNewsAt = headline.at;
      riotUi.news(headline.text);
    }
    if (!local) { riotUi.setObjective(null, null); return; }
    const obj = objectiveAt(minutes);
    const dist = obj ? Math.hypot(local.position.x - obj.zone.x, local.position.z - obj.zone.z) : 0;
    riotUi.setObjective(obj, local.faction, dist, phaseAt(minutes).title, riot.lineState);

    // Tear gas: slows you, hazes the screen, makes you cough. Masks help (outfit editor!).
    const exposure = local.inVehicle ? 0 : riot.gasAt(local.position.x, local.position.z) * (1 - gasProtection(local.look));
    gasLevel += (exposure - gasLevel) * (1 - Math.exp(-(exposure > gasLevel ? 3 : 0.6) * dt));
    riotUi.setGas(gasLevel);
    local.speedFactor = 1 - 0.55 * gasLevel;
    if (gasLevel > 0.3 && now > coughAt) { coughAt = now + 1200 + Math.random() * 900; sfx.cough(Math.min(1, gasLevel + 0.3)); }

    // Ambient sound: crowd murmur and drums near the crowd, the helicopter overhead.
    const s = riot.state;
    const crowdDist = s.crowdCount ? local.position.distanceTo(s.centroid) : 999;
    const near = Math.max(0, 1 - crowdDist / 70);
    const heliVol = s.heliOn ? Math.max(0, 1 - local.position.distanceTo(s.heliPos) / 110) : 0;
    sfx.ambience(s.chantLevel * near * Math.min(1, s.crowdCount / 40), heliVol * 0.6);
    if (s.drumHit) sfx.drum(near * 0.7, s.drumHit === 1);
    const line = riot.line;
    if (phaseAt(minutes).id === 'clashes' && Math.random() < dt * 0.25) {
      sfx.whistle(Math.max(0, 1 - Math.hypot(local.position.x - line.x, local.position.z - line.z) / 50));
    }
  }

  // Handy for debugging in the browser console: type `game` and press Enter.
  window.game = { riot, riotUi, scene, physics, truck, remotes, props, net, cam, get local() { return local; }, get score() { return score; } };
}

start();
