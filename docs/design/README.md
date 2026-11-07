# Design directions

Three rendered directions for the interface, built on 7 November 2026 with the real
character artwork and the real cast, before the interface itself was changed. Each
is a working preview (`index.html`) with a stage, character browsing and a creator,
and is responsive to a phone. Rebuild them with `node docs/design/build.mjs` and
repeat the measurements with `node docs/design/measure.mjs`.

| | 1 · Main Stage (chosen) | 2 · Coin-Op | 3 · Workbench |
| --- | --- | --- | --- |
| Idea | An illustrated band under one spotlight | A collectible arcade cabinet | A warm cut-paper workshop |
| Composition | One line of large figures on a curved floor; a dock around one Play | A numbered grid of twelve slots beside a control panel | A shelf of figures under notes pinned to a desk |
| Type | Bricolage Grotesque, DM Sans | Bungee, Chakra Petch | Fraunces, Caveat, Nunito Sans |
| Characters | Bold outlines, flat colour, large | Rasterised to pixels | Sticker edge, soft shadow, slight tilt |
| Primary action | Play, then a dashed Add a character | Play, among six arcade buttons | Make a character, beside Play the shelf |
| Stage | [desktop](1-main-stage/desktop-stage.png), [phone](1-main-stage/phone-stage.png) | [desktop](2-coin-op/desktop-stage.png), [phone](2-coin-op/phone-stage.png) | [desktop](3-workbench/desktop-stage.png), [phone](3-workbench/phone-stage.png) |
| Browsing | [desktop](1-main-stage/desktop-browse.png), [phone](1-main-stage/phone-browse.png) | [desktop](2-coin-op/desktop-browse.png), [phone](2-coin-op/phone-browse.png) | [desktop](3-workbench/desktop-browse.png), [phone](3-workbench/phone-browse.png) |
| Creator | [desktop](1-main-stage/desktop-creator.png), [phone](1-main-stage/phone-creator.png) | [desktop](2-coin-op/desktop-creator.png), [phone](2-coin-op/phone-creator.png) | [desktop](3-workbench/desktop-creator.png), [phone](3-workbench/phone-creator.png) |

## How they compared

| Against | Main Stage | Coin-Op | Workbench |
| --- | --- | --- | --- |
| Primary action understood | One Play, one add target | Play is clear; six equal buttons compete with it, and empty slots fill the screen | Make and Play compete for first place |
| Characters and roles differ | Large enough for every trait to read | Pixelation hides eyes, mouths and clothes, which is exactly what the creator lets people choose | Clear, and charming |
| Collaboration fits | Faces and Chat stay at the top of the stage | The player metaphor suits it, but points to scores and collecting, which the product rules out | A desk reads as one person's; friends become a sidebar list |
| Creator and sections fit | A dressing room; a strip above the stage | Cramped in a side panel | The creator is its best feature; sections have no natural place |
| Axe findings (stage and creator) | 0 | 0 | 2 contrast |
| Frames per second, 12 moving figures, 4× CPU throttling | 61 | 60 | 60 |

The frame-rate measurement did not separate them, so it is no reason for the choice.
Everything except the two measured rows is a judgement, made by looking at the
screenshots rather than by watching anyone use them.

## The choice

Main Stage, because it is the only one that reads as a band straight away, and it
keeps characters large, which is where the creator's work shows. Coin-Op's tactile
depth carried over to the Play control. The cost of Main Stage showed in the preview
and was fixed in the real interface: dark outlines fade into a dark wall, so the
stage is lighter behind the characters.

## What shipped

Screenshots of the finished interface are in [`built/`](built/): the
[empty stage](built/desktop-fresh.png), a [full stage of twelve](built/desktop-twelve.png),
[sections](built/desktop-sections.png), the [creator](built/desktop-creator-music.png),
[reactions on a performer's stage](built/desktop-reactions.png), and the
[stage](built/phone-stage.png), [step grid](built/phone-pattern.png) and
[creator](built/phone-creator.png) on a phone.
