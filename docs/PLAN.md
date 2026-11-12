# Place de la République: where we are and what's next

Handover notes (11 Nov 2026), so the project can be picked up on another computer.
Everything below was discussed and decided while building the game with Claude.

- Live game: https://place-de-la-republique.ulbrich-sauda.workers.dev
- Code: https://github.com/rodrigosauda/place-de-la-republique
- How to install, run and deploy: see the main [README](../README.md).

---

## 1. Setting up on a new (personal) computer

1. Install **Git**, **Node.js** (version 20 or newer) and **GitHub Desktop**.
2. Clone the repository: GitHub Desktop → File → Clone repository → `rodrigosauda/place-de-la-republique`
   (or in Terminal: `git clone https://github.com/rodrigosauda/place-de-la-republique.git`).
3. In the project folder, once: `npm install`
4. Play locally: `npm run dev`, then open http://localhost:5173
5. Log in to Cloudflare once: `npx wrangler login` (your own Cloudflare account, the one that hosts the live game).
6. Put a new version online: `npm run deploy`
7. Tests (with `npx wrangler dev --port 8787` running in another Terminal window):
   `node scripts/shop-test.mjs` · `node scripts/truck-test.mjs` · `node scripts/icecream-test.mjs` · `node scripts/join-test.mjs`

Push your changes to GitHub with GitHub Desktop ("Push origin") before and after working, so GitHub always has the latest version.

> Keep this project on a **personal** computer and personal accounts (not a work laptop or work network).

---

## 2. The game today (what is built)

**Setting:** the real Place de la République in Paris (OpenStreetMap data), one protest "day" every 12 real minutes:
the crowd gathers, marches at 14:00, clashes with the police at 17:00, curfew at 23:00. Cartoon brawls only:
protesters fight with a baguette, police with a rubber chicken, 3 hits = K.O.

**Look (decided 9 Nov):**
- Protesters: black/grey "black bloc" clothes, hood up, black bandana, **red armband**. Red is the team colour.
- The yellow vest is an optional (free) outfit item. "Yellow Vests" was renamed "Protesters" everywhere.
- Police: near-black uniform, helmet with visor, shield, blue accents. Some have the visor up, some brawlers have no shield.

**Start screen:** two big cards (Protesters / Riot Police) with a picture of your own character, your name and Play.
"Customise character" opens the outfit editor (Quick looks + tabs Clothes / Head / Body / Extras), placard text and role.

**Fights:**
- Fight **circles** (statue + 4 circles) that flare up and die down; a faint red ring shows the hot ones.
- Groups of 4 protesters walk in from a street, a police squad walks in from the police side, they fight a few minutes, walk out.
- 3 police patrol squads and small protester groups walk a loop round the square, so there is someone to fight everywhere.
- The police shield line (clashes / curfew) has protesters pushing against it; it reacts to players.
- Better walk and K.O. animations (stagger, fall sideways, stars, get up).

**Water cannon truck:**
- New model (white, blue band, POLICE, grille, turret, blue lights).
- **Police only, 2 seats:** driver + cannon operator (alone, the driver does both). E to get in/out.
- V switches chase camera / **cannon view**; the mouse aims the jet.
- It **shoves everyone aside** at any speed (no K.O.), the jet pushes everyone (a raised shield only softens it).
  Ramming protesters fast costs the police public opinion.
- Protesters can stop it: **6 protesters** around it (NPCs count half) or 3 bins/barriers in front;
  hitting its windscreen splashes paint that blinds the driver for 4 s.

**Big screen:** clock, score and today's **top 3 knock-outs per side** (resets each game day); placed in front of the
balconies, trees in front removed. The **ad banner** sits next to it (content to be decided).

**Free game with coins (decided 11 Nov):**
- No real money: no company, bank account or payment provider for now.
- **50 tasks** (16 for everyone, 17 protesters, 17 police) pay 20–120 coins once. Press **P** to see them all.
- Daily missions +25 coins, each level +30, winning the day +50, 60 coins to start.
- **Coin shop:** cosmetic items for coins (picture of every item, try-on on your own character, tabs, bundles show the saving).
- Coins and unlocked items are kept in the player's browser; the server no longer checks ownership.
- The full task list is in `shared/tasks.js`.

**Ice-cream van "Glaces Marianne"** (north side): E to buy an ice cream for 15 coins → +1 heart
(a 4th if you are full); you can't hit, throw or use gas for the 6 s you eat it; one every 40 s.
The mint ring around the van is a **no-fighting zone**.

---

## 3. Decisions taken (and why)

| Date | Decision | Why |
|---|---|---|
| 9 Nov | Black bloc look, red team colour, yellow vest optional | Matches recent photos of Paris clashes |
| 9 Nov | Prices €0.50–€5 (later replaced by coins) | Cheap cosmetics |
| 10 Nov | Make this map right before a second map (no bus/Arc de Triomphe yet) | Focus |
| 10 Nov | Water cannon: chase cam + cannon view, police only, 2 seats, pushes instead of K.O., protesters can stop it | Cartoon tone, counterplay |
| 10 Nov | 6 protesters to stop the truck (was 3) | Too easy |
| 11 Nov | Everything free; coins earned with tasks; no payments, no company | Too much admin for now; grow players first |
| 11 Nov | Ice-cream van with +1 heart and a no-fighting zone | Fun, a safe spot |
| 11 Nov | No Instagram clip mode / follow link for now | Not now |

**Money, later (advice given):** affiliate/ad income is still business income in Germany (Gewerbeanmeldung,
Kleinunternehmerregelung, Impressum, privacy page, ad labelling). Grow players first (browser game portals like
CrazyGames/Poki, short gameplay clips), then decide. Not legal or tax advice: check with a Steuerberater.

---

## 4. To do next (in order)

1. **Check the latest version in a real match:** tasks counting, buying an ice cream (E), the truck with 2 police players,
   patrols and hits outside the circles.
2. **Game flow:** clear goals for each side in each phase of the day (the tasks are a first step).
3. **Public beta safety** before sharing the link widely: chat mute/report, spam limits, lock down the stats and
   preview links, Impressum and privacy page.
4. **Firefighters at the protests, only peacefully:** firefighters marching with the protesters in uniform (helmets,
   banners), never fighting; maybe a "Firefighter" role/outfit that can't hit but can put out fires; a news headline
   when they join.
5. **Shops in the buildings** (more than the ice-cream van): bakery (fresh baguette), café, pharmacy (heal), paid in coins.
6. **More shop items:** the protester gear range (bandanas, balaclavas, gas mask, goggles, helmets, gloves, shoes,
   bags, jackets, flags, umbrellas; needs new slots for shoes, gloves and bag), police gear, weapon skins,
   knock-out effects, emotes. Concept pictures were made in the shop plan document.
7. **Coins on several devices:** a code to move coins and unlocked items to another browser.
8. **Ad banner content:** decide what goes on it (game news, an Instagram account, partners).
9. **Second map later:** Arc de Triomphe (big roundabout) with a bus between the two squares, as a separate room.

Known limits: coins live in one browser (clearing it resets them); old purchases from the test shop were not carried over.

---

## 5. Where things are in the code

| What | File |
|---|---|
| Rules, constants, message types, safe zones, ice-cream van place | `shared/constants.js` |
| Tasks, coin rewards, coin prices | `shared/tasks.js` |
| Outfits catalogue | `shared/looks.js` |
| Shop products and bundles | `shared/shop.js` |
| Day timeline, fight circles, streets, fighter groups | `shared/timeline.js` |
| Server (one room = one Durable Object): fights, truck, line, ice cream | `worker/GameRoom.js` |
| Game client (main loop, input, network, HUD wiring) | `client/main.js` |
| Background crowd, police line, patrols | `client/scene/riot.js` |
| Characters / animations | `client/player/playerMesh.js`, `client/combat/effects.js` |
| Truck and water jet | `client/vehicle/Truck.js`, `client/vehicle/WaterSpray.js` |
| Ice-cream van | `client/scene/iceCreamVan.js` |
| Start screen, outfit editor, shop, tasks panel | `client/ui/startMenu.js`, `outfitEditor.js`, `shop.js`, `progress.js` |
| Coins wallet (in the browser) | `client/shop/wallet.js` |
| Server tests | `scripts/shop-test.mjs`, `scripts/truck-test.mjs`, `scripts/icecream-test.mjs`, `scripts/join-test.mjs` |

The detailed shop plan (with pictures of the products and the proposed protester gear) is the Claude document
"Shop improvement plan": https://claude.ai/artifact/1ZgGEWS6Kemsz7M3sU2LGA
