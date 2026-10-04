// Case data — "The Cold Springs of Tbili".
// Real places + real history; the culprit, suspects and the cold-springs night are invented.
window.CASE = {
  id: 'cold-springs',
  title: 'The Cold Springs of Tbili',
  city: 'Old Tbilisi',
  premise:
    'Fifteen centuries ago King Vakhtang Gorgasali\'s falcon chased a pheasant into a hot spring and both were boiled. ' +
    'The king built a city on the spot and named it for the warmth: tbili. Tonight, for the first time, the springs of Abanotubani ran cold. ' +
    'When the water cools, the old things walk. Find who stopped the springs, with what, and where, before dawn.',

  // Sanctuaries: denizens cannot enter. [lat, lng, radius m, name]
  sanctuaries: [
    [41.691314, 44.807525, 30, 'Sioni Cathedral'],
    [41.690152, 44.811248, 30, 'Metekhi Church'],
    [41.695502, 44.806873, 25, 'Anchiskhati Basilica'],
  ],

  // Denizens: home point + patrol radius. Ali = water-hags of Georgian folklore. Devi = the many-headed ogre.
  denizens: [
    { kind: 'ali', name: 'Ali of the Baths', home: [41.68790, 44.81160], patrol: 140 },
    { kind: 'ali', name: 'Ali of the Bridge', home: [41.69240, 44.80930], patrol: 160 },
    { kind: 'ali', name: 'Ali of the Fig Gorge', home: [41.68650, 44.80700], patrol: 150 },
    { kind: 'devi', name: 'The Devi', home: [41.68900, 44.80500], patrol: 260 },
  ],

  suspects: [
    { id: 'gela', name: 'Gela', role: 'Mekise (bath scrubber), Chreli Bath' },
    { id: 'ioane', name: 'Father Ioane', role: 'Keeper of the vine cross, Sioni' },
    { id: 'levan', name: 'Levan', role: 'Clockwinder, the leaning tower' },
    { id: 'nato', name: 'Nato', role: 'Antiques seller, Dry Bridge market' },
    { id: 'davit', name: 'Davit', role: 'Falconer, claims the king\'s blood' },
  ],
  means: [
    { id: 'bell', name: 'A falconer\'s bell' },
    { id: 'seal', name: 'A lead church seal' },
    { id: 'key', name: 'A clock key' },
    { id: 'vine', name: 'A grapevine thread' },
    { id: 'salt', name: 'A sack of salt' },
  ],
  places: [
    { id: 'cistern', name: 'The bath cistern' },
    { id: 'well', name: 'The Narikala well' },
    { id: 'tower', name: 'The clock tower' },
    { id: 'crypt', name: 'The Sioni crypt' },
    { id: 'cliff', name: 'The Metekhi cliff' },
  ],
  solution: { who: 'davit', what: 'bell', where: 'well' },

  sites: [
    {
      id: 'baths', num: 'I', name: 'Chreli Bath', place: 'Abanotubani',
      pos: [41.687454, 44.810772], opensAtStart: true, unlocks: ['waterfall'],
      sigil: 'spring',
      approach: 'The blue-tiled bath. Steam should be pouring from the domes. There is none.',
      puzzle: { type: 'rings', prompt: 'Turn the three rings of the bath seal until falcon, pheasant and spring stand in one line under the mark.' },
      lore:
        'The bath-house is silent. Gela, the old mekise, is still in his apron, and six bathers in towels swear he scrubbed them all night without stopping. ' +
        '"It went cold at the third hour," he says. "Not slow. Like someone shut a door under the city." He points uphill, toward the fortress. ' +
        '"The water comes from up there before it comes to us. Everybody forgets that."',
      evidence: [
        { text: 'Gela scrubbed bathers all night, six witnesses.', strikes: ['who:gela'] },
        { text: 'The springs went cold at the third hour.', clue: 'time-hour' },
      ],
    },
    {
      id: 'metekhi', num: 'II', name: 'Metekhi', place: 'Gorgasali\'s statue',
      pos: [41.690152, 44.811248], opensAtStart: true, unlocks: ['sioni'],
      sigil: 'horse',
      approach: 'The king sits his horse on the cliff, one arm raised over the river. Something is scratched into the plinth.',
      puzzle: {
        type: 'cipher', shift: 5,
        cipher: 'YMJ GJQQ WFSL FGTAJ YMJ GFYMX',
        answer: 'THE BELL RANG ABOVE THE BATHS',
        prompt: 'A shifted-letter message. The key is the century in which Gorgasali founded the city.',
      },
      lore:
        'Under the scratches someone has left a single falcon feather, tied with red thread. The message is in a hand that writes like it was taught by a priest. ' +
        'A bell rang above the baths. The fortress sits above the baths. So does the gorge. The clock tower and Sioni do not; they are down in the town.',
      evidence: [
        { text: '"The bell rang above the baths."', strikes: ['where:cistern', 'where:tower', 'where:crypt'] },
        { text: 'A falcon feather tied with red thread.', clue: 'feather' },
      ],
    },
    {
      id: 'waterfall', num: 'III', name: 'Leghvtakhevi', place: 'The Fig Gorge waterfall',
      pos: [41.686806, 44.809003], requires: ['baths'], unlocks: ['clock'],
      sigil: 'fig',
      approach: 'The waterfall at the end of the Fig Gorge. The stream is running cold enough to ache.',
      puzzle: {
        type: 'order',
        prompt: 'The waterfall\'s stones are carved with the city\'s sieges. Set them in the order they happened.',
        items: [
          { label: 'Vakhtang Gorgasali founds the city', year: '5th c.' },
          { label: 'The Arab Emirate of Tiflis', year: '736' },
          { label: 'David the Builder retakes the city', year: '1122' },
          { label: 'The Mongols take the city', year: '1236' },
          { label: 'Timur sacks the city', year: '1386' },
          { label: 'Agha Mohammad Khan burns the city', year: '1795' },
        ],
      },
      lore:
        'Behind the falling water, the rock is wet on one side only: the fortress side. The cold is coming down from Narikala, not across the river from Metekhi. ' +
        'Caught in the fig roots there is a small brass tag stamped with a clock face, its hands at a quarter past.',
      evidence: [
        { text: 'The cold came down from the fortress side, not from Metekhi.', strikes: ['where:cliff'] },
        { text: 'A brass clock tag, hands at a quarter past.', clue: 'time-minute' },
      ],
    },
    {
      id: 'sioni', num: 'IV', name: 'Sioni', place: 'Cathedral of the vine cross',
      pos: [41.691314, 44.807525], requires: ['metekhi'], unlocks: ['clock'],
      sigil: 'vine',
      approach: 'Sioni keeps St Nino\'s cross, two vine stems bound with her own hair. A sanctuary. Nothing old walks in here.',
      puzzle: {
        type: 'lights',
        prompt: 'Tie the vine knots into Nino\'s cross. Touching a knot flips it and its neighbours.',
        target: [0,1,0, 1,1,1, 0,1,0],
      },
      lore:
        'Father Ioane has not left the cross all night; the candle stubs at his feet prove it, and the vine thread is still wound where it should be. ' +
        '"A man came at dusk asking which bell the falconers of the old kings used," he says. "I told him those bells are in museums. He laughed and said not all of them."',
      evidence: [
        { text: 'Father Ioane kept vigil all night.', strikes: ['who:ioane'] },
        { text: 'The vine thread never left the cross.', strikes: ['what:vine'] },
      ],
    },
    {
      id: 'clock', num: 'V', name: 'The Leaning Tower', place: 'Clock tower, Shavteli Street',
      pos: [41.695838, 44.80657], requires: ['waterfall', 'sioni'], unlocks: ['narikala'],
      sigil: 'clock',
      approach: 'The crooked clock tower. Its angel should strike the bell on the hour. The clock face is dead.',
      puzzle: { type: 'clock', prompt: 'Set the hands to the moment the springs went cold. You have both halves of it.', hour: 3, minute: 15 },
      lore:
        'The clock starts again with a groan, and from inside, someone hammers on the door. Levan the clockwinder has been locked in his own tower since the second hour, ' +
        'with his key turned in the lock from outside. "He wanted the angel\'s little bell," Levan says. "Said it was the wrong bell anyway. Then he locked me in and left."',
      evidence: [
        { text: 'Levan was locked in his own tower all night.', strikes: ['who:levan'] },
        { text: 'The clock key was used to lock the door, nothing more.', strikes: ['what:key'] },
      ],
    },
    {
      id: 'narikala', num: 'VI', name: 'Narikala', place: 'The fortress above the springs',
      pos: [41.687729, 44.809111], requires: ['clock'], unlocks: ['deda'],
      sigil: 'tower',
      approach: 'The old fortress. Below its walls, a well shaft drops toward the sulfur. Frost on the rim. In October.',
      puzzle: {
        type: 'riddle',
        prompt: 'Scratched into the well-stone:\n"The king named the city for me.\nI was taken from it tonight.\nGive me back and the city keeps its name."',
        answers: ['warmth', 'warm', 'tbili', 'heat'],
        choices: ['Water', 'Warmth', 'Salt', 'The falcon'],
        correct: 'Warmth',
      },
      lore:
        'The frost on the rim is salt-crusted, but that is only the spring\'s own minerals. The lead seal on the well cover is unbroken; nobody went in that way. ' +
        'Tucked under the stone is a receipt from the Dry Bridge market, Nato\'s stall: "1 falconry hood, 1 brass bell, 19th c. Sold to a man who said his family flew birds for the king."',
      evidence: [
        { text: 'The salt on the well is only the spring\'s minerals.', strikes: ['what:salt'] },
        { text: 'The lead seal on the well is unbroken.', strikes: ['what:seal'] },
        { text: 'Nato only sold the bell; she named the buyer.', strikes: ['who:nato'] },
      ],
    },
    {
      id: 'deda', num: 'VII', name: 'Kartlis Deda', place: 'Mother of Georgia',
      pos: [41.68812, 44.804603], requires: ['narikala'], unlocks: [],
      sigil: 'sword', final: true,
      approach: 'Mother Georgia stands over the city with a bowl of wine for friends and a sword for enemies. A man waits at her feet, a bell in his hand.',
      puzzle: { type: 'deduce', prompt: 'Name who stopped the springs, with what, and where. A wrong accusation costs a candle.' },
      lore:
        'Davit does not run. "My bird died to found this city," he says. "Fifteen hundred years, and every guidebook calls it a nice story about soup. ' +
        'I rang his bell down the well so the springs would remember him." Mother Georgia holds out wine in one hand and the sword in the other. You get to choose which he gets.',
      evidence: [],
    },
  ],
};

window.CASES = window.CASES || {};
window.CASES.tbilisi = window.CASE;
