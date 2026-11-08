# Place de la République — low-poly multiplayer pilot

A lighthearted browser game: pick **Yellow Vests** or **Riot Police** and play on the REAL
Place de la République in Paris (every building, street, tree and lamp from OpenStreetMap).
Everything runs on **one Cloudflare Worker** (free plan): static client + a `GameRoom` Durable Object.

## Folder structure

```
place-de-la-republique/
├── index.html              # page shell + loading screen, loads client/main.js
├── package.json            # scripts: dev, build, preview, deploy
├── vite.config.js          # build to dist/, proxy /ws -> wrangler dev in development
├── wrangler.jsonc          # Worker + static assets + Durable Object + migration
├── scripts/                # ensure-dist.js (empty dist/ for wrangler dev) · build-map.py (OSM -> mapData.json)
├── data/                   # raw OpenStreetMap download
├── public/                 # hdr/ (sky lighting) · ads/ (advertising wrap, see ads/README.txt)
├── shared/                 # used by BOTH client and server
│   ├── constants.js        # TICK_RATE, message types, factions, weapons, spawns, bases, timing
│   ├── timeline.js         # the protest day: phases, objectives, police line
│   ├── looks.js            # outfit catalogue
│   └── filter.js           # bad-word filter
├── worker/
│   ├── index.js            # routes /ws and /stats to GameRoom, serves everything else from dist/
│   └── GameRoom.js         # the Durable Object: players, truck, props, NPCs, police line, scores
└── client/
    ├── main.js             # wiring + game loop
    ├── style.css · quality.js
    ├── scene/   renderer · world · haussmann · lighting · dayNight · atmosphere · textures · riot ·
    │            bases · bigScreen · adBanner · tags · streetFurniture · mergeStatic · camera · mapData.json
    ├── physics/ physics.js            # Rapier wrapper
    ├── player/  input · playerMesh · LocalPlayer · RemotePlayer
    ├── vehicle/ Truck · WaterSpray
    ├── props/   StreetProps.js        # bins and barriers
    ├── combat/  effects.js            # BONK! texts, hit flash, weapon animations
    ├── audio/   sfx.js                # all sounds are synthesised (Web Audio)
    ├── network/ NetClient · interpolation
    └── ui/      startMenu · hud · minimap · bottomBar · chat · outfitEditor · riotUi · touchControls
```

## 1. Install (once)

You need Node.js 20 or newer (`node -v` to check).

```bash
cd place-de-la-republique
npm install
```

## 2. Run locally

```bash
npm run dev
```

This starts two things side by side:
- **Vite** on http://localhost:5173 (the game client, hot reload)
- **wrangler dev** on http://localhost:8787 (the Worker + Durable Object)

Vite forwards `/ws` to wrangler, so just open **http://localhost:5173**.

## 3. Test multiplayer with two tabs

1. Open http://localhost:5173 in one tab → name "A", Yellow Vest → Play.
2. Open a second tab (or a private window) → name "B", Riot Police → Play.
3. Put the tabs side by side. Move in one, and you'll see the other move.
4. Walk to the white truck near the monument, press **E** to drive. In the other
   tab, pressing E near the truck now shows "Truck driven by A".
5. Close one tab: the player disappears in the other one.

Tip: open the browser console and type `game` to inspect the state.

## 4. Deploy to Cloudflare (free plan)

```bash
npx wrangler login     # once: opens the browser to log in to your Cloudflare account
npm run deploy         # = vite build && wrangler deploy
```

Wrangler prints your URL, e.g. `https://place-de-la-republique.<you>.workers.dev`.
Share it with a friend and play together. Re-run `npm run deploy` after each change.

To test the production build locally first: `npm run preview` then open http://localhost:8787.

## Controls

| Action | Keyboard / mouse | Phone |
|---|---|---|
| Look around | just move the mouse (click once to capture it, Esc to free it) | drag the view |
| Move / jump | WASD or arrows / Space | joystick / Jump |
| Run | hold Shift | Run |
| Dodge roll (short burst, 1.5 s cooldown) | C | Dash |
| Hit (baguette / rubber chicken) | click or F | Hit |
| Block (police shield also stops water) | hold right mouse or Q | Block / Spray |
| Pick up / throw a bin or barrier; protesters: throw a fresh tear-gas canister back | G (click also throws) | Grab / Throw |
| Tear gas (police) | H | Tear gas (police only) |
| Role ability (medic / journalist / drummer) | R | Role |
| Missions, level and badges | P | tap the missions box |
| Skip the first-steps guide | K | tap the panel |
| Truck in / out | E | Truck |
| Water cannon (in truck) | hold click or Space | Block / Spray |
| Chat / chants / mute | Enter / 1–4 / M | Chat |
| Outfit · emotes · graffiti tag | O · T · V (or the bottom bar) | bottom bar |
| Zoom | mouse wheel | — |

Slow computer? Add `?quality=low` to the link (no shadows, fewer details).

## Features

- Yellow Vests vs Riot Police. One weapon each: a baguette (protesters) and a rubber chicken (police, it squeaks).
  Right-click block for everyone (police shield also blocks water). Extra weapons are planned as paid items.
- 3 hits = K.O. for 3 s. Every K.O. = 1 point for your side.
- Water-cannon truck: one driver at a time; the jet shoves people (you can't walk against it) and slides bins.
  Driving into people at speed knocks them out ("BOUM!"). Turn it off with `TRUCK_KNOCKDOWN` in `shared/constants.js`.
- Bins and crowd barriers: push them, or pick them up (G) and throw them (hits = 1 damage).
- NPCs: the last 20 players who joined walk around the square while they're offline, and chant.
- Haussmann-style Paris: stone façades, iron balconies, zinc roofs, shops with awnings, Morris columns,
  Wallace fountains, métro entrances, café terrace, water mirror, the Monument à la République with the lion.
- Day/night cycle (1 game day = 12 real minutes, but not evenly: the night 00:00-06:00 takes 40 s, the morning 06:00-09:00 takes 60 s, 09:00-23:00 takes 40 s per game hour and 23:00-24:00 takes 60 s, so most of the real time goes to the march and the clashes; see `CLOCK_SEGMENTS` in `shared/constants.js`). Curfew 23:00–06:00: the side with the most players
  on the plaza scores every 5 s. Scores reset at 06:00. Big screen with score + clock.
- Characters with arms/legs (man, woman, papy, mamie) and an outfit editor with a live 3D preview:
  skin, hair, tops (incl. marinière), trousers, hats (beret, bonnet phrygien…), face (sunglasses, scarf,
  gas mask…), back items, placard style, Riot Police unit number. Catalog: `shared/looks.js`.
  Items marked `premium` show a € badge; they're free while `PREMIUM_ENFORCED = false`.
- Emotes (wave, hands up, clap, dance, sit) and graffiti tags on walls (5 per game day).
- Bottom menu bar: Outfit · Emotes · Tag · Chat · Menu (controls, sound, quality).
- More realistic look: a real sky with a moving sun, light from an HDR photo (CC0, Poly Haven),
  filmic colours, soft corner shadows and night glow (high quality), painted stone / zinc / paving /
  asphalt textures with surface relief, French windows and shop fronts, smoother characters.
- Advertising wrap on the south building: see `public/ads/README.txt` (image + `ads.json` + deploy).
  Impressions (players who saw it 2+ s) appear in `/stats` under `ads`.
- Player statistics: open `/stats` on your game URL (joins, unique players, peak per game day).
- **Minimap** (bottom right): the real streets, rotated to where the camera looks. It shows today's objective
  (an arrow on the rim when it is out of view), both bases, the truck, other players and the police line.
- **Dodge roll** (C): a quick 3 m burst. Not while blocking, carrying something or K.O.
- **Hit feedback**: the camera shakes and the screen edge flashes red when you get hit; landing a hit gives a small shake.
- The truck is released automatically if the driver sits in it for 45 s without moving or spraying.
- Chat bubbles, chants, sound effects, bad-word filter, auto-reconnect, touch controls.
- Tweak numbers in `shared/constants.js` (weapons, water, truck, props, NPCs, curfew…).

## The real map

`client/scene/mapData.json` is built from OpenStreetMap (map data © OpenStreetMap contributors, ODbL;
the credit is shown in the corner of the game). To rebuild it after changing `scripts/build-map.py`:

```bash
pip install shapely
python3 scripts/build-map.py   # reads data/republique-osm.json, writes client/scene/mapData.json
```

Coordinates are metres with the monument at (0, 0). The long side of the square runs along x:
west (-x) = Boulevard de Magenta / Saint-Martin, east (+x) = Boulevard du Temple / Voltaire.

## The protest day ("Act I")

Every game day (12 real minutes) replays the same protest day, in every browser at once
(`shared/timeline.js`):

| Time | What happens | Goal |
|---|---|---|
| 06–10 | Quiet morning, a few people | — |
| 10–14 | The crowd gathers around the monument, drums | — |
| 14–17 | The march leaves along Boulevard de Magenta; police block Boulevard du Temple (route to Bastille) | hold the Magenta zone |
| 17–20 | Clashes: the police line pushes towards the square unless protesters hold it, tear gas, red flares, smoke, helicopter | barricade (3+ bins/barriers) at Boulevard du Temple |
| 20–23 | The crowd thins out | hold the métro entrance |
| 23–06 | Curfew: the police line sweeps the square (protesters can slow or stop it), searchlight | stay on / clear the square |

- Breaking news banner, today's goal under the clock and a ring on the ground.
- Police lines block you and hit protesters who stand in front of the shields (police players walk through their own line).
- The line REACTS to players during the clashes and the curfew sweep (`updatePoliceLine` in `worker/GameRoom.js`):
  it advances on its own (faster with police backing it), stops when enough protesters stand in front of the
  shields or bins/barriers are piled there, and falls back when protesters clearly outnumber it
  (real player = 1.5, NPC = 1, piled bin/barrier = 1.5). Status under the goal: advancing / HELD / FALLING BACK.
  An advancing line shoves barricades; it fires tear gas every ~9 s; a police player charging alone into the
  crowd in front of it gets hit by the crowd.
- Protesters can pick up a fresh tear-gas canister (less than 8 s old) with G and throw it back.
- NPC police and NPC protesters fight each other and real players nearby (blocking works on them too).
- The background crowd (about 110 people) walks, cheers and waves placards; hit them and they fall over.
- Hold **Shift** to run.
- Tear gas: police press **H**. It slows you, hazes the screen and makes you cough. A gas mask or goggles
  protect you fully; a face mask or scarf protects you halfway.
- Bases: the police start between two police buses in front of the Caserne Vérines (north side), the
  protesters in front of the real Café République (south side). Inside a base's ring nobody can hit or be hit, and there is no tear gas
  (`BASES` in `shared/constants.js`).
- At 06:00 everybody gets an end-of-day summary (winner, top 5 players, awards), then the whole square
  resets: bins and barriers back in place, the truck parked and full of water, graffiti cleaned, every
  player back in their base.

## Public opinion and the daily scenarios

Inspired by the protests in France in autumn 2026 (fictional characters; cartoon brawls only, no real
politicians, logos or footage).

**Public opinion meter** (bar under the clock, 0 = with the police, 100 = with the protesters; constants in
`OPINION`, `shared/constants.js`; logic in `worker/GameRoom.js`):

- Knocking out a protester costs opinion for whoever struck (violence backfires); knocking out police
  while the march is peaceful helps the police side, and police violence rallies opinion to the protesters.
- Chanting together (keys 1-4) adds a little, capped per player per minute and per 10 s.
- Tear gas on a dense group of protesters makes opinion swing towards them.
- Holding the day's objective moves it too. It slowly drifts back to 50.
- Opinion changes the police line: the more people support the protest, the slower the line advances
  and the faster it falls back. Thresholds trigger news headlines. Opinion is part of the end-of-day summary.

**Scenarios** rotate by game day (`SCENARIOS` in `shared/timeline.js`), named after real dates:

| Order | Scenario | What changes |
|---|---|---|
| 1 | Act I · 17 Oct | The police line builds up in steps through the afternoon |
| 2 | Act II · 24 Oct | Rain, last-minute route change of the march (east, Boulevard du Temple) |
| 3 | Halloween · 31 Oct | Calm and slow police until 18:30, then a harder, gassier evening |
| 4 | Union day · 5 Nov | Opinion swings strongly, slower line, little gas, fewer police |

Testing: open the game with `?scenario=act1|act2|halloween|union` to force one, or set `SCENARIO` in the
worker env for the server side (they must match).

## Roles, events and the first minute

**Roles** (optional, picked in the start menu, one ability on **R**; `ROLES` in `shared/constants.js`, logic in
`handleAbility` in `worker/GameRoom.js`). The server checks cooldown, distance and who may take the role.

| Role | Who | R does |
|---|---|---|
| Medic ✚ | both sides | stands up a hurt or K.O. person within 4 m (anyone), a little sympathy for the protest, counts in the day's awards |
| Journalist 📷 | protesters | photographs what happened in the last 15 s within 30 m: police violence exposed helps the protest, protesters fighting hurts it, a calm march helps a little (each incident can be photographed once) |
| Drummer 🥁 | protesters | drums (needs 6+ protesters within 12 m to help public opinion); stronger rallies when you stand in an event ring |

**Events** (`EVENTS` in `shared/timeline.js`, a cyan ring on the ground and on the minimap, an "EVENT" line under the
goal, and a headline): *speech at the monument* 11:30, *brass band* 13:00 (renamed *costume parade* on Halloween) and
*live TV at the front line* 17:30. Rally events give protesters standing inside a slow public-opinion bonus (capped per
event per day; more police than protesters inside cancels it; a drummer boosts it). During live TV every K.O. inside the
ring moves public opinion twice as much.

**First steps**: a short guide (move, reach the goal, hit, block, chant, role) shown once; it is remembered in your browser.
Use `?tutorial=1` to replay it.

**Coming back**: the browser remembers your day streak, days played and days won (`client/profile.js`, localStorage only).
Stars next to your name at 3, 7 and 15 days played are sent when you join (cosmetic only). The start menu shows how the
last finished day ended (`/last`, public and tiny) and your streak, and the end-of-day window shows your own line.

**Feedback**: every public-opinion change shows a floating number next to the bar ("+1.5 photo"), with a soft tick; crossing
70 or 30 plays a chime. The camera pulls in when a tree trunk, lamp post or wall is between you and the view. The game
lowers its resolution by itself if the frame rate stays under about 30 fps (and raises it again when there is room).
Rain wets the ground and softens the shadows. Audio is still synthesized (no sound files): crowd murmur, rhythmic chanting,
distant sirens, helicopter, rain with drips, drum phrases, camera shutter.

## Feel: hit-stop, debris, crowd, role gear

- **Hits**: a brief freeze (about 55 ms, 130 ms on a K.O.) when you land or take a hit, camera shake, a burst of crumbs
  or rubber-chicken feathers (`client/combat/impact.js`), a ring on the ground and extra stars on a K.O., block sparks, a
  different word every time (CRUNCH / WHACK / SQUEAK / HONK...), and pitch-varied hit sounds.
- **Crowd**: 200 extras at full quality (110 with `?quality=low`), one in ten carries a waving flag on a tall pole, and eight
  pairs carry readable banners ("WAGES FIRST", "OUR FUTURE"...) that stay stretched between the two walkers.
- **Role gear you can see from far away**: the medic has white armbands and red crosses, the journalist a blue PRESS
  tabard and a camera, the drummer a drum on the belly (`addRoleGear` in `client/player/playerMesh.js`).

## Social layer: online counts, missions, badges, spectating

- **Who is online** (`/online`, public and tiny): the start menu shows how many protesters, police and spectators are on the
  square and which side needs players. It refreshes every 10 s while the menu is open.
- **Just watch**: a spectator joins with `{ t: 'j', sp: 1 }`. They get the roster, snapshots, chat, news and score, but no
  body, no score and no way to act (the server ignores everything else they send). Space / arrows follow a player, F is the
  free view, "Join the protest" reloads into the menu. Spectators keep the NPCs walking but do not count as players.
- **Daily missions, level and badges** (`client/ui/progress.js`, localStorage only): three missions per real day, picked by
  date, side and role (a medic gets a treat-people mission, police never get graffiti). +40 XP per mission, +100 per badge,
  +60 for a won day, plus a little for time played; level n starts at 60 x (n-1)^2 XP. Violence resets the "peaceful
  play" mission. Nothing here is sent to the server, so it is cosmetic. Press P (or tap the box) for the full panel.
- **Live leaderboard**: today's top 5 (knock-outs, route points, tags, treatments, photos) is broadcast at most every 5 s
  when it changes (`MSG.BOARD`), shown in the P panel; `/last` also carries the last day's top 3 for the start menu.
- **Two more events**: *students arrive with banners* (09:30, east of the square) and *candlelight vigil* (20:00, at the
  monument), both peaceful rally events.
- Slogan quick-picks under the placard field (the profanity filter in `shared/filter.js` still applies on the server).

## How the networking works (short version)

- Each client sends `{t:'s', p:[x,y,z], r, v}` every `TICK_MS` (only when it changed).
- `GameRoom` stores the latest state and broadcasts one snapshot
  `{t:'S', p:[[id,x,y,z,r,v],...], v:[x,y,z,r,owner]}` at the same rate, only if something changed.
- Names/factions are sent separately in a roster message (`{t:'r'}`) only when someone joins or leaves.
- The truck: client asks `{t:'e'}`, the server answers `{t:'v', o: ownerId}` to everyone.
  The driver's position is the truck position.
- Remote players and the truck are drawn `INTERP_DELAY_MS` (100 ms) in the past and blended between two snapshots.
- Rooms: `/?room=friends` puts you in a separate Durable Object.

## Free plan budget (rough numbers)

- Incoming WebSocket messages count as 1 request per 20 messages. 1 player moving
  non-stop at 10 Hz for 1 hour ≈ 1,800 requests. The daily free limit is 100,000 requests,
  so about 55 player-hours of constant movement per day. Raising `TICK_RATE` to 20 halves that.
- Outgoing messages (the broadcasts) are not billed as requests.
- The room stops its timer after 3 idle seconds so the Durable Object can hibernate.

Free-plan limits change from time to time; check https://developers.cloudflare.com/durable-objects/platform/pricing/.

## Server rules against cheating (short version)

- Positions sent by clients are checked against a movement budget (`MAX_MOVE_SPEED` in `worker/GameRoom.js`,
  30 m/s): teleports and speed hacks are pulled back towards the server's copy. After a K.O. you always get up next to your own base.
- Sockets that never send `JOIN` are closed after 15 s and don't block the room.
- Ad impressions count once per player name per campaign per game day.
- `/stats` can be protected: `npx wrangler secret put STATS_KEY`, then open `/stats?key=<your secret>`
  (add `&room=friends` for another room). Without the secret it stays public.

## Next steps

The full, up-to-date list of features and next steps is in the Game Guide doc on claude.ai
("Place de la République — Game Guide"). Top of the list right now:

1. Deploy and check speed on a real computer and a phone (frame counter, automatic lower detail).
2. Balance the fighting and the reacting police line with real players.
3. Phone buttons for Run and tear gas.
4. Make the background crowd look like the real players.
5. Café République interior and a rooftop view; then accounts, leaderboard and paid items.
