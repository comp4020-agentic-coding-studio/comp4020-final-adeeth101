# Research

Sources behind the design claim in `README.md`, grouped the way the brief
groups them. Each entry gives the source and one sentence on what it
contributed to this app's design — not a full literature review.

## Live coding and shared editors

What each project decides about who may edit what, since that is the design
question this app answers differently.

- **TidalCycles** — Alex McLean, [tidalcycles.org](https://tidalcycles.org/).
  A Haskell pattern language for one performer at a time; patterns are
  functions from time to sound rather than explicit timelines, which is where
  this app's "canonical pattern shape" comes from, even though Tidal itself is
  single-author.
- **Strudel** — Felix Roos and Alex McLean, [strudel.cc](https://strudel.cc/),
  a JavaScript/browser port of Tidal's pattern engine running since January
  2022. It is the REPL every browser in this app evaluates locally; the server
  never touches audio because Strudel already assumes it runs client-side.
- **Flok** — Damián Silvani, [flok.cc](https://flok.cc/) /
  [source](https://github.com/munshkr/flok). A peer-to-peer collaborative text
  editor (WebRTC, CodeMirror) where everyone shares one editable buffer per
  language slot — editing is undifferentiated: whoever is in a slot can change
  anything in it. This app instead gives each visitor their own track, so
  simultaneous edits don't collide inside one person's line.
- **Gibber** — Charlie Roberts, [gibber.cc](https://gibber.cc/). A pure
  JavaScript, audiovisual live-coding environment with built-in support for
  networked ensemble performance, where remote users can control a shared
  running instance. It's evidence that browser-only, no-install live coding
  with multiple simultaneous users is an established pattern, not a novel risk
  this project is taking alone.
- **Estuary** — David Ogborn et al.,
  [estuary.mcmaster.ca](https://estuary.mcmaster.ca/) /
  [paper](https://zenodo.org/records/6767377). A zero-install, multilingual
  ensemble platform (running since late 2015) built specifically for
  geographically distributed live-coding ensembles, including a "roulette"
  mode where performers take turns modifying shared code. Estuary coordinates
  *multiple languages* in one ensemble; this app instead coordinates *one
  language at two levels of abstraction* (grid and text) in one shared space,
  which is the gap the design claim sits in.

## The spectrum of abstraction

The strongest evidence for the claim, since it's the actual bet the project
makes.

- **Trackers** — originating with Karsten Obarski's Ultimate Soundtracker
  (Amiga, 1987); overview at
  [Wikipedia: Music tracker](https://en.wikipedia.org/wiki/Music_tracker).
  Trackers represent a song as a numeric grid in fixed time slots — the
  oldest working precedent for a *visual, tactile* interface over music that
  is otherwise symbolic/textual underneath, which is the same move this app's
  step-sequencer view makes over Strudel patterns.
- **Max/MSP** — Miller Puckette, begun 1985 at IRCAM; overview at
  [Wikipedia: Max (software)](https://en.wikipedia.org/wiki/Max_\(software\)).
  A dataflow visual language where patches are built by connecting objects
  with cords rather than writing text — the canonical case for a fully visual
  alternative to text-based music programming, and the far end of the
  "abstraction spectrum" this app's grid sits on.
- **Pure Data** — Miller Puckette, begun around 1996 as an open-source
  successor to Max/MSP; overview at
  [Wikipedia: Pure Data](https://en.wikipedia.org/wiki/Pure_Data). Confirms
  the visual dataflow approach generalised beyond one commercial tool, and
  that audio and control signals were treated uniformly in that visual model.
- **Sonic Pi** — Sam Aaron, originally built at the University of Cambridge
  Computer Laboratory with the Raspberry Pi Foundation; overview at
  [Wikipedia: Sonic Pi](https://en.wikipedia.org/wiki/Sonic_Pi). A text-based
  live-coding language explicitly designed to teach programming through
  music to complete beginners — evidence that *text* can also have a low
  floor when the teaching stance is deliberate, which is why this app doesn't
  assume text is inherently the "expert" side and grid the "beginner" side; it
  assumes both can be true at once for different people.
- **Mitchel Resnick and Brian Silverman, "Some reflections on designing
  construction kits for kids"**, Interaction Design and Children conference,
  2005 —
  [paper (ResearchGate)](https://www.researchgate.net/publication/247589124_Some_reflections_on_designing_construction_kits_for_kids).
  The low-floor/wide-walls framing (extending Papert's low-floor/high-ceiling
  idea for Logo): a tool should be easy to start with and open to many kinds
  of use, not just one path to mastery. This is the direct source for the
  README's "spectrum of abstraction" language — the grid is the low floor, the
  text editor is the high ceiling, and letting both act on the same shared
  state is the wide wall.

## Small web and tools for small groups

- **IndieWeb** — overview at
  [Wikipedia: IndieWeb](https://en.wikipedia.org/wiki/IndieWeb). Decentralised,
  independently hosted, small-scale personal publishing as the alternative to
  platform-mediated social software — the ethos behind running this app as one
  dependency-free Node process on a single small Fly machine rather than
  reaching for a managed real-time backend.

## What I could not verify, and left out

- I could not find a citable primary source (paper, official changelog, or
  documented decision) for *why* each of Flok, Gibber and Estuary chose their
  particular editing-permission model, only descriptions of the resulting
  behaviour from their own sites/docs and secondary write-ups. The comparisons
  above are drawn from what those sources document about current behaviour,
  not from a stated design rationale, and are worded to reflect that.
- I did not cite a specific "small web manifesto" document, since the sources
  I found describing the movement are blog posts and wikis summarising a
  loose, uncredited cultural trend rather than a single authored source; I
  cited Wikipedia's IndieWeb entry instead, which is the closest to a stable,
  checkable reference.
