# Process overview

Ensemble is an application where users create a mix together through one shared link. Users select a character and place it on the stage for the character to begin playing its sequence. Once on stage, users may modify the sound of the character, add or delete steps of the character's sequence, or directly manipulate the character's code. I wanted users with various levels of music and programming knowledge to be able to collaborate within Ensemble.

My desire to allow multiple user collaboration was also influenced by my prior experience working with Flok as a participant in a course titled "Sound and Music Computing." All participants collaborated in a single, shared text-based code editor. Although all participants could easily overwrite another's code contributions, it was difficult to determine what portion of the code each contributor had created. I desired to provide a method for novice musicians to quickly generate a sound, while at the same time providing experienced programmers with control over their creations.

## How did the project evolve?

By Crit #8, the project was called Stream. Stream allowed users to maintain their own identity within the web browser across separate visits. It maintained a shared activity record, provided a grid connected to its pattern code, and contained basic browser audio functionality. By Crit #9, the project evolved into a studio with owned tracks, block and instrument views, and a code editor. The three distinct interfaces (views) utilized the same versioned musical representation. In addition to these features, Stream provided saved performance plans and a shared clock. By Crit #10, server logs tracked who made each modification and who requested modifications that were denied.

[341df24](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/341df24) [27fb6cd](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/27fb6cd) [cf626ea](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/cf626ea)

The studio was much easier for people with prior knowledge of patterns. Some users were also looking for additional guidance when they first used it. What people wanted to do could be seen through peer requests for sound editing, exporting, creating sections and reacting. To better address this, I created a different starting point (characters on a stage) and removed Blockly. In addition to those items, by November, I had also included editable appearance options, the option to use and reuse the same characters in different mixes, and an adjustable grid that edits supported steps directly within the user's source document.

[3acd15f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/3acd15f) [97314f9](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/97314f9) [128bd70](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/128bd70)

## What specific design decisions did I make regarding the technology used in Ensemble?

For the purpose of simplicity, I decided to utilize Node.js's built-in HTTP server and SQLite on a Fly volume. As such, all aspects of the server and related data storage existed within one small machine. When a change is submitted via the client-side interface, a database transaction will save both the change and the corresponding event simultaneously. However, there are some trade-offs involved with making these two components operate together as efficiently as possible. For example, only one database writer can operate at a time, and changes to the document structure require migrations. Furthermore, utilizing Server-Sent Events (SSE), clients receive notifications when relevant data has been modified. Clients retrieve updated snapshot representations of the current state. To facilitate successful connection recovery, SSE necessitates support for event recovery, maintaining order among events, and implementing access restrictions. Additionally, when a user loses access rights to certain information, they should no longer receive any private update communications.

Each browser uses a common clock and shared plans to compile and play Strudel patterns. Therefore, each device does not need to download audio streams from the server. Each device can still have a different output delay. Since the submitted pattern code must go through a restricted parser rather than be allowed to run as free-form JavaScript, this severely restricts the features of Strudel that can be utilized within the application. However, since the parsing is controlled, the app has full authority to determine what type of content it will accept. When migrating older mixes into newer versions of the application, they retain all of their musical relationships regardless of whether certain elements are only editable via code.

[e3993c2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/e3993c2)

## Interaction With Agent

Prior to implementing the application, I created a document outlining the users' capabilities/permissions and how the application would check for completion. In the document, I specified that once a performance was shared with others, all unused project materials would remain private. Additionally, I stated that if a request was denied by the application, it should identify which user made such a request. The application should also preserve any handwritten code. During development checkpoints, I reviewed results and directed my subsequent modifications based upon those reviews. Issues had to be reproduced before a correction could be verified. Based on six such findings, I implemented six corrections.

[448eea8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/448eea8) [7f66d94](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/7f66d94)

## Interface Design

I asked the agent to create three different renderings of the design for the interface. The agent chose Main Stage because it provided both character controls and playback controls in the same view. Upon testing Main Stage at phone width, I agreed with this choice. Reviewing the designs prior to selecting the final design enabled me to compare various layout configurations. Several items regarding motion, keyboard ordering, and focus while performing background updates still required browser-specific checks. The agent executed and reported back on all automated tests. I performed listening tests.

[5324a68](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/5324a68) [93e9aa6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/93e9aa6)

## Sharing Private Clips

One test revealed that private clips that were never used in a performance were being exposed to an audience when a performance was published. The application was exposing the entire workspace, including private clips that had been saved but left un-staged. The error was treating the project as a single entity for visibility purposes. I modified the rule so that the audience sees only the music that is used by the performance. To accomplish this modification, I filtered the data that is shared with the audience down to just that portion of the data that corresponds to the performance's plan. Later I found a related issue where stopping playback caused the saved plan and mix settings to be lost. To correct this issue, I implemented a solution to preserve the saved plan and mix settings after playback stops.

[a2390a6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/a2390a6) [f4e645c](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/f4e645c)

## Four-bar patterns made non-editable

When I tried to make some changes to a character with four bars of sixteen steps that was open in the editor it would not allow me to do anything. I soon realized that the limit had been set to apply to all of the character's bars rather than just one. I raised the limit to see if that would help, but it didn't fix my problem because I was still using the wrong setting. What needed to be done was to create a new way of separating the limits of how many steps each bar can contain from the overall number of steps. One regression test is to ensure that users are able to edit valid four-bar patterns. That same test fails under the previous rule. Once I created the new rule, I ran it through CI and sent it out. Next I went back to my live creator and tested both marking viewport widths to confirm that the grid worked once again.

[1746159](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/1746159)

## Feedback and Decisions

My peer feedback helped prioritize my sound editing, export, sectioning and reaction features. However, I also felt that users should be able to build a character's look by choosing parts, as opposed to simply altering a preset's colors. Users now get a copy of the shared character whenever they use it. Listings are populated with saved snapshots so that when the user goes back to edit them, they won't change existing copies.

[74cfeab](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/74cfeab) [f5743a9](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/f5743a9) [4a369ea](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/4a369ea) [8781c80](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/8781c80)

I decided upon fixed rules for build-up suggestions based on the roles of the characters on stage. By doing this I am making sure that there is predictability and consistency. Using an outside AI tool was an alternative. I could also save those suggestions into the shared plan, but I opted for the easier-to-implement rule-based model.

[e3e4c5d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/e3e4c5d)

## Check and Remaining Gaps

Our automated testing suite covers individual identity, permission for editing, privacy concerns, potential conflicts of saving and record keeping of who participated. No ordinary listener can edit. Guest performers may edit their own session tracks as long as they are admitted guests. The browser checks include testing the production version of our site, reduced motion, slow connection speeds, and ability to use a keyboard at mobile-width. We also manually checked our saved work after we re-deployed.

[7259aa3](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/7259aa3)

Using the Manual Release Sheet on 7 November 2026, I did a basic usability test on the deployed website. I found issues with side-scrolling at mobile-width and small navigation targets. Both issues were resolved by improving layouts and enlarging navigation targets. The listening across two laptops served as an informal timing test. However, it does not measure output latency. Our final build still requires an uncoached first-use test and a screen reader test. Representative network testing for our application remains incomplete, although a deployed timing measurement already exists.

