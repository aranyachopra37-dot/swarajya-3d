// The world.
//
// Deliberately ours. The systems are borrowed from a genre; the place, the names
// and the creeds are not borrowed from anyone. That matters legally once real
// money is involved, and it matters practically because an invented world is an
// asset the project owns outright.
//
// THE ORGANISING IDEA: the three creeds are three AGES, not three factions.
// Wild is what stood here before the Empire. Order is the Empire, in its last
// century. Forge is what comes next and does not care what either believed.
// Choosing a creed is choosing which age you think you are living in — and
// because you never pick one, only build, the answer arrives sideways.
//
// Kept short on purpose. The research was clear that lore works when attached to
// things the player already touches: a name and a grudge beats three paragraphs
// of history nobody reads. Every unit and building carries its own line; this
// file is only the frame around them.

export const WORLD = {
  title: "Rout",

  setting: `The Empire kept one law above all others: hold the road. Then the
Empire stopped answering letters, and the roads became somebody else's problem.
Yours.`,

  gate: `What you hold is not a castle. It is a gate in a wall that used to mean
something, on a road that still does.`,

  // The thesis of the game, plain enough for a loading screen.
  creed: `An army is not killed. It is convinced.`,

  // Shown once at the start of a battle, rotating.
  openers: [
    "An army is not killed. It is convinced.",
    "Hold the road. Nobody remembers who told you to.",
    "They have further to run than you have to stand.",
    "Every man on that road would rather be somewhere else. Remind him.",
    "The Empire is four hundred miles away and has been for nine years.",
  ],
};

export const CREED_LORE = {
  WILD: {
    name: "Wild",
    age: "The Old Age",
    era: "before the Empire",
    text: `Older than the road. Older than the wall, and older than the law that
built it. Wild asks for very little and takes it constantly. Its stones were
standing when the first surveyor arrived with a rope and an opinion, and the
briars have been patient ever since.`,
    boon: "Every building you own works faster.",
    // Said when devotion deepens.
    tier: [
      "",
      "Something in the treeline has started paying attention.",
      "The briars come when called now. You did not teach them that.",
    ],
  },

  ORDER: {
    name: "Order",
    age: "The Empire",
    era: "the age that is ending",
    text: `What is left of the Church holds that a man who runs is worth more
than a man who dies — he carries the fear home with him, and tells it to
others. Order builds bells, and rings them at the moment a line begins to
doubt.`,
    boon: "Every building you own frightens harder.",
    tier: [
      "",
      "The bells are answered from somewhere further off.",
      "Men who have never seen your gate have begun to dread it.",
    ],
  },

  FORGE: {
    name: "Forge",
    age: "The Age Coming",
    era: "what replaces both",
    text: `The guilds never argued with the Church. They simply kept casting.
Forge holds that will is a slow instrument and iron is a fast one, and that a
road can be emptied in a single breath by a machine which believes nothing at
all.`,
    boon: "Every building you own kills harder.",
    tier: [
      "",
      "The guild has sent a second founder, unasked.",
      "They are casting something at the coast they will not describe in writing.",
    ],
  },
};

/**
 * A one-line description of who the player has become, based on what they built.
 * This is the whole point of the alignment system: you never picked a side, and
 * yet here you are.
 */
export function describeAlignment(devotion, tiers) {
  const ranked = Object.entries(devotion)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return "Unaligned — you have built nothing that believes anything.";
  }

  const [topId, topCount] = ranked[0];
  const top = CREED_LORE[topId];
  const tier = tiers[topId] ?? 0;

  if (ranked.length > 1 && ranked[1][1] === topCount) {
    const second = CREED_LORE[ranked[1][0]];
    return `Divided — ${top.name} and ${second.name} in equal measure.`;
  }

  const titles = ["Leaning toward", "Sworn to", "Devoted to", "Consecrated to"];
  return `${titles[Math.min(tier, titles.length - 1)]} ${top.name} · ${top.age}`;
}

/** The line to print when devotion to a creed deepens. */
export function tierLine(creedId, tier) {
  const creed = CREED_LORE[creedId];
  if (!creed) return "";
  return creed.tier[Math.min(tier, creed.tier.length - 1)] || "";
}
