// client/network/NetClient.js
// Plain browser WebSocket client. It knows nothing about Three.js:
// it only sends/receives small JSON messages and calls your callbacks.
//
// Auto-reconnect: if the connection drops (Wi-Fi hiccup, a new deploy,
// Cloudflare restarting the room...), it reconnects by itself and joins
// again AT YOUR CURRENT POSITION, so nothing "resets".

import { MSG } from '../../shared/constants.js';

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 5000]; // then keeps trying every 5 s

export class NetClient {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.retries = 0;
    // Called when (re)joining, so we can send our current position. main.js sets it.
    this.getJoinPose = () => null;
    // Callbacks — main.js replaces these.
    this.onWelcome = () => {};
    this.onRoster = () => {};
    this.onSnapshot = () => {};
    this.onVehicle = () => {};
    this.onSwing = () => {};
    this.onHit = () => {};
    this.onBlocked = () => {};
    this.onPush = () => {};
    this.onChat = () => {};
    this.onScore = () => {};
    this.onProps = () => {};
    this.onCarry = () => {};
    this.onEmote = () => {};
    this.onTag = () => {};
    this.onTags = () => {};
    this.onTagsLeft = () => {};
    this.onFly = () => {};
    this.onStatus = () => {};
    this.onGas = () => {};
    this.onNews = () => {};
    this.onSummary = () => {};
    this.onReset = () => {};
    this.onCrowd = () => {};
    this.onAbility = () => {};
    this.onBoard = () => {};
    this.spectate = false; // true = just watching (no body, no score)
    this.role = '';  // 'm' | 'j' | 'd' | '' (set by main.js)
    this.badge = 0;  // loyalty stars 0-3 (cosmetic)
  }

  connect(name, faction) {
    this.name = name;
    this.faction = faction;
    this.open();
  }

  open() {
    // Same host as the page: works on localhost (via the Vite proxy) and on workers.dev.
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const room = new URLSearchParams(location.search).get('room') || 'main';
    const ws = new WebSocket(`${protocol}://${location.host}/ws?room=${encodeURIComponent(room)}`);
    this.ws = ws;
    this.onStatus(this.retries ? 'reconnecting' : 'connecting');

    ws.addEventListener('open', () => {
      this.retries = 0;
      this.onStatus('connected');
      const join = this.spectate
        ? { t: MSG.JOIN, sp: 1 }
        : { t: MSG.JOIN, n: this.name, f: this.faction, s: this.slogan || '', l: this.look, ro: this.role, bd: this.badge };
      const pose = this.getJoinPose();
      if (pose) { join.p = pose.p; join.r = pose.r; }
      this.send(join);
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const now = performance.now(); // arrival time, used for interpolation

      switch (msg.t) {
        case MSG.WELCOME: this.myId = msg.id; this.onWelcome(msg.id); break;
        case MSG.ROSTER: this.onRoster(msg.l); break;
        case MSG.SNAPSHOT: this.onSnapshot(msg, now); break;
        case MSG.VEHICLE: this.onVehicle(msg.o); break;
        case MSG.SWING: this.onSwing(msg.id, msg); break;
        case MSG.HIT: this.onHit(msg); break;
        case MSG.BLOCKED: this.onBlocked(msg.id); break;
        case MSG.PUSH: this.onPush(msg); break;
        case MSG.CHAT_OUT: this.onChat(msg); break;
        case MSG.SCORE: this.onScore(msg); break;
        case MSG.PROPS: this.onProps(msg.l); break;
        case MSG.CARRY: this.onCarry(msg); break;
        case MSG.EMOTE_OUT: this.onEmote(msg); break;
        case MSG.TAG_OUT: this.onTag(msg.g); break;
        case MSG.TAGS: this.onTags(msg.l); break;
        case MSG.TAGS_LEFT: this.onTagsLeft(msg.n); break;
        case MSG.FLY: this.onFly(msg); break;
        case MSG.GAS_OUT: this.onGas(msg); break;
        case MSG.NEWS: this.onNews(msg.m); break;
        case MSG.SUMMARY: this.onSummary(msg); break;
        case MSG.RESET: this.onReset(); break;
        case MSG.CROWD_OUT: this.onCrowd(msg); break;
        case MSG.ABILITY_OUT: this.onAbility(msg); break;
        case MSG.BOARD: this.onBoard(msg.l); break;
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return; // an old socket, ignore
      this.myId = null;
      this.onStatus('reconnecting');
      const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)];
      this.retries++;
      setTimeout(() => this.open(), delay);
    });
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }
}
