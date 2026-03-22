/**
 * Drawing prompt words for Outsmart.io
 * Categorized by difficulty
 */

const WORDS_EASY = [
  'cat', 'dog', 'sun', 'tree', 'house', 'fish', 'car', 'star', 'moon', 'hat',
  'ball', 'bird', 'cake', 'boat', 'door', 'eye', 'fire', 'rain', 'snow', 'bed',
  'cup', 'key', 'lamp', 'shoe', 'flag', 'bell', 'book', 'egg', 'hand', 'leaf',
  'nose', 'ring', 'worm', 'bone', 'duck', 'frog', 'gift', 'kite', 'nail', 'pear',
  'tent', 'wave', 'bike', 'clock', 'cloud', 'crown', 'drum', 'fork', 'grape', 'heart',
  'juice', 'knife', 'lemon', 'mouse', 'ocean', 'phone', 'queen', 'snake', 'tooth', 'whale',
  'apple', 'bread', 'chair', 'earth', 'ghost', 'horse', 'ice', 'jelly', 'llama', 'music',
  'orange', 'pizza', 'river', 'spoon', 'train', 'umbrella', 'water', 'zebra', 'candy', 'fence',
];

const WORDS_MEDIUM = [
  'airplane', 'baseball', 'butterfly', 'campfire', 'dinosaur', 'elephant', 'fireworks',
  'giraffe', 'hamburger', 'igloo', 'jellyfish', 'kangaroo', 'lighthouse', 'mermaid',
  'nightmare', 'octopus', 'penguin', 'rainbow', 'scarecrow', 'telescope',
  'unicorn', 'volcano', 'windmill', 'xylophone', 'treasure', 'spaceship',
  'skeleton', 'sandwich', 'parachute', 'mushroom', 'microphone', 'magician',
  'ladybug', 'iceberg', 'hammock', 'goldfish', 'football', 'eyebrow',
  'dragon', 'cowboy', 'compass', 'castle', 'bridge', 'anchor',
  'astronaut', 'backpack', 'ballerina', 'cactus', 'caterpillar', 'chandelier',
  'chocolate', 'coconut', 'cupcake', 'dolphin', 'dominoes', 'feather',
  'flamingo', 'galaxy', 'garden', 'guitar', 'helmet', 'island',
  'jacket', 'kitten', 'lantern', 'marble', 'mountain', 'necklace',
  'paintbrush', 'parrot', 'pirate', 'pumpkin', 'pyramid', 'robot',
  'rocket', 'saddle', 'scissors', 'seesaw', 'shadow', 'suitcase',
  'sunrise', 'surfboard', 'tornado', 'trophy', 'turtle', 'vampire',
  'waterfall', 'wizard', 'wreath',
];

const WORDS_HARD = [
  'allergies', 'avalanche', 'blueprint', 'camouflage', 'democracy',
  'encryption', 'frustration', 'generation', 'hibernation', 'illusion',
  'jealousy', 'knowledge', 'labyrinth', 'meditation', 'negotiate',
  'orchestra', 'philosophy', 'quarantine', 'revolution', 'sabotage',
  'technology', 'underground', 'vegetarian', 'wanderlust', 'zero gravity',
  'time travel', 'black hole', 'global warming', 'wifi signal', 'dream',
  'evolution', 'gravity', 'imagination', 'perspective', 'sarcasm',
  'déjà vu', 'karma', 'paradox', 'awkward silence', 'brain freeze',
];

function getRandomWord(difficulty = 'mixed') {
  let pool;
  if (difficulty === 'easy') pool = WORDS_EASY;
  else if (difficulty === 'medium') pool = WORDS_MEDIUM;
  else if (difficulty === 'hard') pool = WORDS_HARD;
  else pool = [...WORDS_EASY, ...WORDS_MEDIUM]; // mixed = easy + medium

  return pool[Math.floor(Math.random() * pool.length)];
}

function getWordChoices(count = 3) {
  const all = [...WORDS_EASY, ...WORDS_MEDIUM, ...WORDS_HARD];
  const picks = [];
  const used = new Set();
  while (picks.length < count && picks.length < all.length) {
    const w = all[Math.floor(Math.random() * all.length)];
    if (!used.has(w)) { used.add(w); picks.push(w); }
  }
  return picks;
}

module.exports = { getRandomWord, getWordChoices, WORDS_EASY, WORDS_MEDIUM, WORDS_HARD };
