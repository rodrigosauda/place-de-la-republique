// shared/tasks.js
// The game is free: you earn COINS by doing tasks, and spend them in the shop (cosmetics) and at the
// ice-cream van. 50 tasks: some for everyone, some only for protesters ('g') or only for the police ('c').
// Each task counts one event (see client/ui/progress.js -> event()). `time: true` = counted in seconds.
// Tasks are done once (for ever, in this browser). Daily missions (3 a day) pay coins too.

export const COINS = {
  mission: 25,     // each daily mission
  win: 50,         // your side wins the day
  level: 30,       // each new level
  start: 60,       // a welcome gift on your first game
};

// Shop prices in coins: twice the old price in cents (€0.50 -> 100 coins, €1 -> 200, €2 -> 400).
export const coinsForCents = (cents) => Math.round(cents * 2);

export const ICE_CREAM_COST = 15;   // coins per ice cream

// side: null = everyone. coins: the reward. Ordered roughly from easy to hard.
export const TASKS = [
  // ---- everyone (16)
  { id: 'firststeps', side: null, ev: 'tutorial', goal: 1, coins: 20, text: 'Finish the first steps' },
  { id: 'chant10', side: null, ev: 'chant', goal: 10, coins: 20, text: 'Chant 10 times (keys 1–4)' },
  { id: 'emote5', side: null, ev: 'emote', goal: 5, coins: 20, text: 'Use 5 emotes (T)' },
  { id: 'dash10', side: null, ev: 'dash', goal: 10, coins: 20, text: 'Dodge-roll 10 times (C)' },
  { id: 'icecream1', side: null, ev: 'icecream', goal: 1, coins: 20, text: 'Eat an ice cream at the van' },
  { id: 'spots5', side: null, ev: 'spot', goal: 5, coins: 40, text: 'Visit all 5 fight circles' },
  { id: 'play10', side: null, ev: 'play', goal: 600, coins: 30, text: 'Play 10 minutes', time: true },
  { id: 'block10', side: null, ev: 'block', goal: 10, coins: 30, text: 'Block 10 hits (right mouse)' },
  { id: 'throw10', side: null, ev: 'throw', goal: 10, coins: 30, text: 'Throw 10 bins or barriers (G)' },
  { id: 'rally180', side: null, ev: 'rally', goal: 180, coins: 40, text: 'Take part in events for 3 minutes', time: true },
  { id: 'peace600', side: null, ev: 'peace', goal: 600, coins: 40, text: 'Play 10 minutes in a row without knocking anyone out', time: true },
  { id: 'chant50', side: null, ev: 'chant', goal: 50, coins: 50, text: 'Chant 50 times' },
  { id: 'block50', side: null, ev: 'block', goal: 50, coins: 60, text: 'Block 50 hits' },
  { id: 'icecream10', side: null, ev: 'icecream', goal: 10, coins: 60, text: 'Eat 10 ice creams' },
  { id: 'win1', side: null, ev: 'win', goal: 1, coins: 80, text: 'Be on the winning side at the end of a day' },
  { id: 'play60', side: null, ev: 'play', goal: 3600, coins: 100, text: 'Play 60 minutes in total', time: true },

  // ---- protesters (17)
  { id: 'tag3', side: 'g', ev: 'tag', goal: 3, coins: 20, text: 'Spray 3 graffiti tags (V)' },
  { id: 'grab5', side: 'g', ev: 'grab', goal: 5, coins: 20, text: 'Pick up 5 bins or barriers for a barricade (G)' },
  { id: 'soaked10', side: 'g', ev: 'soaked', goal: 10, coins: 20, text: 'Get soaked by the water cannon 10 times' },
  { id: 'gasback1', side: 'g', ev: 'gasBack', goal: 1, coins: 30, text: 'Throw a tear-gas canister back (G)' },
  { id: 'hold180', side: 'g', ev: 'hold', goal: 180, coins: 30, text: 'Hold today\'s goal zone for 3 minutes', time: true },
  { id: 'ko5g', side: 'g', ev: 'kos', goal: 5, coins: 30, text: 'Knock out 5 police officers' },
  { id: 'linehold60', side: 'g', ev: 'lineHold', goal: 60, coins: 40, text: 'Stand in front of the police line for 60 s while it is held', time: true },
  { id: 'paint1', side: 'g', ev: 'paint', goal: 1, coins: 40, text: 'Paint the water cannon\'s windscreen (hit its front)' },
  { id: 'truckstop1', side: 'g', ev: 'truckStop', goal: 1, coins: 40, text: 'Help stop the water cannon (6 protesters around it)' },
  { id: 'tag15', side: 'g', ev: 'tag', goal: 15, coins: 50, text: 'Spray 15 graffiti tags' },
  { id: 'gasback5', side: 'g', ev: 'gasBack', goal: 5, coins: 50, text: 'Throw 5 tear-gas canisters back' },
  { id: 'lineback30', side: 'g', ev: 'lineBack', goal: 30, coins: 60, text: 'Push the police line back (30 s in front of it while it retreats)', time: true },
  { id: 'hold900', side: 'g', ev: 'hold', goal: 900, coins: 80, text: 'Hold goal zones for 15 minutes in total', time: true },
  { id: 'ko25g', side: 'g', ev: 'kos', goal: 25, coins: 80, text: 'Knock out 25 police officers' },
  { id: 'paint5', side: 'g', ev: 'paint', goal: 5, coins: 80, text: 'Paint the water cannon 5 times' },
  { id: 'tag50', side: 'g', ev: 'tag', goal: 50, coins: 120, text: 'Spray 50 graffiti tags' },
  { id: 'photo5', side: 'g', ev: 'photo', goal: 5, coins: 60, text: 'As a journalist, take 5 photos (R)' },

  // ---- police (17)
  { id: 'gas5', side: 'c', ev: 'gas', goal: 5, coins: 20, text: 'Fire tear gas 5 times (H)' },
  { id: 'drive120', side: 'c', ev: 'drive', goal: 120, coins: 30, text: 'Drive the water cannon for 2 minutes', time: true },
  { id: 'gunner120', side: 'c', ev: 'gunner', goal: 120, coins: 30, text: 'Work the cannon (second seat) for 2 minutes', time: true },
  { id: 'spray60', side: 'c', ev: 'spray', goal: 60, coins: 30, text: 'Spray water for 60 seconds', time: true },
  { id: 'ko5c', side: 'c', ev: 'kos', goal: 5, coins: 30, text: 'Knock out 5 protesters' },
  { id: 'lineadv60', side: 'c', ev: 'lineAdvance', goal: 60, coins: 40, text: 'Stand in the shield line for 60 s while it advances', time: true },
  { id: 'escort60', side: 'c', ev: 'escort', goal: 60, coins: 40, text: 'Escort the water cannon (stay close while it sprays) 60 s', time: true },
  { id: 'curfew180', side: 'c', ev: 'curfew', goal: 180, coins: 40, text: 'Patrol the square during the curfew for 3 minutes', time: true },
  { id: 'grab5c', side: 'c', ev: 'grab', goal: 5, coins: 30, text: 'Clear a barricade: pick up 5 bins or barriers (G)' },
  { id: 'medic5c', side: 'c', ev: 'treat', goal: 5, coins: 50, text: 'As a police medic, treat 5 people (R)' },
  { id: 'gas25', side: 'c', ev: 'gas', goal: 25, coins: 60, text: 'Fire tear gas 25 times' },
  { id: 'spray300', side: 'c', ev: 'spray', goal: 300, coins: 60, text: 'Spray water for 5 minutes in total', time: true },
  { id: 'drive900', side: 'c', ev: 'drive', goal: 900, coins: 80, text: 'Drive the water cannon for 15 minutes in total', time: true },
  { id: 'lineadv300', side: 'c', ev: 'lineAdvance', goal: 300, coins: 80, text: 'Advance with the shield line for 5 minutes in total', time: true },
  { id: 'ko25c', side: 'c', ev: 'kos', goal: 25, coins: 80, text: 'Knock out 25 protesters' },
  { id: 'curfew900', side: 'c', ev: 'curfew', goal: 900, coins: 100, text: 'Patrol during curfews for 15 minutes in total', time: true },
  { id: 'block100c', side: 'c', ev: 'block', goal: 100, coins: 120, text: 'Block 100 hits with your shield' },
];

export const tasksFor = (side) => TASKS.filter((t) => !t.side || t.side === side);
