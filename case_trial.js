// Trial walk: 55 Havelock Road -> Tiong Bahru Plaza (Anytime Fitness). Tests the hunters on a real route.
// Route is an OSM walking route (routing.openstreetmap.de, foot profile), ~835 m.
window.CASES = window.CASES || {};
window.CASES.trial = {
  id: 'trial-tiong-bahru', type: 'trial',
  title: 'Trial walk: Havelock to Tiong Bahru',
  city: 'Bukit Ho Swee, Singapore',
  premise:
    'Le Chiffre left his last black card somewhere inside Tiong Bahru Plaza. Get there from 55 Havelock Road without being seen. ' +
    'Masked sentries of the Masque guard the streets on the way, lanterns raised: stay out of their light. ' +
    'Schneebley, the beaked one, starts behind you. He goes wherever you were last seen.',
  start: [1.290081, 103.829495],
  route: [[1.290081, 103.829495], [1.29008, 103.829535], [1.289723, 103.829522], [1.289428, 103.829512], [1.289423, 103.829484], [1.2892, 103.829466], [1.289129, 103.829448], [1.289059, 103.829381], [1.289027, 103.829306], [1.289018, 103.829206], [1.289112, 103.828916], [1.289045, 103.828889], [1.289108, 103.828708], [1.289232, 103.828421], [1.289307, 103.828272], [1.289241, 103.828236], [1.289187, 103.828209], [1.289209, 103.828156], [1.289119, 103.828107], [1.288893, 103.827995], [1.288837, 103.827976], [1.288785, 103.827958], [1.288756, 103.827948], [1.288746, 103.827919], [1.288481, 103.8278], [1.288514, 103.827722], [1.2884, 103.827674], [1.28828, 103.827622], [1.288273, 103.827617], [1.28827, 103.827611], [1.288268, 103.827603], [1.28827, 103.827595], [1.288279, 103.827573], [1.288063, 103.82748], [1.287789, 103.827361], [1.28772, 103.827331], [1.287649, 103.827302], [1.287611, 103.827339], [1.287274, 103.827333], [1.286815, 103.827331], [1.286736, 103.827336], [1.286744, 103.827416], [1.286739, 103.827434], [1.286702, 103.827589], [1.286675, 103.827583], [1.286644, 103.827577], [1.286592, 103.827567], [1.286417, 103.82753], [1.286366, 103.827521], [1.28629, 103.827506], [1.286158, 103.827478], [1.286054, 103.827456], [1.286029, 103.827451], [1.286019, 103.827449], [1.286003, 103.827445], [1.286023, 103.82735], [1.286062, 103.827144], [1.28636, 103.82733]],
  sanctuaries: [],
  denizens: [],
  // Sentries, placed by distance along the route (metres). pace = walks back and forth; sweep = stands and swings its lantern.
  patrols: [
    { mode: 'pace', from: 110, to: 185 },
    { mode: 'sweep', at: 330, sweep: 150, period: 10 },
    { mode: 'pace', from: 420, to: 495 },
    { mode: 'sweep', at: 600, sweep: 150, period: 8 },
    { mode: 'pace', from: 690, to: 760 },
  ],
  boss: { name: 'Schneebley', from: [200, 160] },   // metres north, east of the start
  escalate: { every: 150, cap: 9 },                 // a new sentry ahead of you every 2.5 min
  sites: [
    {
      id: 'plaza', num: '★', name: 'Tiong Bahru Plaza', place: 'Anytime Fitness',
      pos: [1.28636, 103.82733], opensAtStart: true, final: true, sigil: 'card',
      approach: 'The plaza. Somewhere in here is Le Chiffre\'s last card.',
      puzzle: { type: 'finish', prompt: '' }, lore: '', evidence: [],
    },
  ],
  suspects: [], means: [], places: [],
};
