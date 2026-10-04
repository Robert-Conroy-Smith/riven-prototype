# Riven — city mystery on foot (prototype)

Static mobile web game. Case I: *The Cold Springs of Tbili* (Old Tbilisi, 7 seals, ~3.5 km).

- `case.js` — all case content (sites, puzzles, lore, evidence, suspects, denizens, sanctuaries). A new city = a new case file.
- `app.js` — engine: GPS / desk-mode movement, Leaflet map, denizen AI + procedural spatial audio, AR seal-finding, 7 puzzle types, casebook, deduction, endings.
- Modes: **Old Tbilisi** (real coordinates) or **Around me** (case folded onto your streets at 0.55× scale, sites can be nudged if unreachable); **On foot** (GPS/compass/camera) or **Desk mode** (tap map to walk, 1×/4×/12×).
- Needs HTTPS on a phone for GPS + camera. Local: `python3 -m http.server 8790` then open http://localhost:8790.
- QA hook: `window.__riven` (`solve(id)`, `puzzle(id)`, `live`, `S`).
