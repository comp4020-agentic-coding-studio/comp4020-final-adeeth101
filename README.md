# Ensemble

A user receives a unique handle (i.e., identifier) without creating an account and can create a mix with a URL to share with others. This would allow users to collaborate over time. Users could continue creating mixes by adding additional participants, or simply listening to one participant perform a mix.

Another reason I wanted to design Ensemble was to support collaboration among individuals with varying degrees of musical knowledge and programming skills. Individuals with less musical knowledge or experience writing code may begin with pre-built sounds created by others. Those interested in greater control could open the step grid and modify both the sound created and the code representing the pattern. Additionally, users needed to be aware of which individual(s) contributed to a particular section of the mix.

The grid and the code are different representations of the same data. When the grid edits a portion of the representation, the steps supported in that portion are modified, while all other code remains unchanged. Any lanes containing only unsupported code will remain visible in the code editor. While this limits the amount of information available for editing within the grid, it does protect custom-written patterns composed by the user. Each character is created from multiple separate visual elements. Therefore, when a shared character is used from the library, the app will create a duplicate instance. Any subsequent modifications made to the duplicated character will not affect the original character.

The concept of placing characters on a virtual stage and having them produce music was inspired directly by Incredibox. Ensemble has been designed utilizing artwork and audio that do not reuse Incredibox's assets. The concepts used to represent musical patterns in Ensemble were derived from both Strudel and TidalCycles. My experience working with Flok in Sound and Music Computing also significantly impacted my approach to this project. One aspect of Flok was a collaborative text editor where contributors had no way of knowing who originally authored a given piece of code. Moreover, when one contributor modified the code, they would overwrite the previous contribution without leaving behind any indication of who originally authored the lines. To avoid similar issues in Ensemble, I implemented features to document contributions and restrict access to editing capabilities.

Resnick and Silverman's 2005 article discussing Construction Kits also greatly influenced my decision to allow users to select a pre-built "character" before they become familiar with the code associated with that character.

Automated testing in Ensemble includes checks against several areas such as whether separate browsers have distinct identities, if users are restricted to editing only those projects that they have permission to modify, if private projects remain private, and if users' saved mixes persist through a restart. Automated testing also verifies that users do not receive any music during an audience performance unless that music is explicitly included in that performance. Editing utilizes a temporary lock mechanism along with a version checking system. If there are conflicts related to versions, then the application prevents saves and retains drafts. Non-authorized listeners cannot edit existing performances. However, an admitted guest performer can edit their own session tracks without automatically joining the mix as a collaborator.

Several questions require test subjects to utilize the application. For example, can beginners make a sound quickly? Do the different editing interfaces feel interconnected? During the critiques, I observed students utilizing the deployed application. On November 7th I performed a general inspection to identify any bugs. I identified two bugs: some horizontal scrolling occurred at mobile screen widths and some navigation targets were too small. Both were resolved with improved layouts and larger navigation targets. Although I did not formally evaluate timing variations between devices via laptop playback, listening across two laptops provided an informal timing check. Differences in device latency may still cause variations.

To minimize distractions during the first session, I omitted account creation entirely and instead assigned generated identifiers to each participant. All build-up suggestion options are based upon predetermined rules that are dependent upon the roles of components currently on stage. Consequently, they are always predictable. The playback process shares a common clock. However, due to potential differences in output latency between devices, timing discrepancies may occur.

## References and project links

- [Incredibox](https://www.incredibox.com/)
- [Strudel](https://strudel.cc/)
- [TidalCycles](https://tidalcycles.org/)
- [Flok](https://flok.cc/)
- [Resnick and Silverman, 2005](https://www.researchgate.net/publication/247589124_Some_reflections_on_designing_construction_kits_for_kids)
- [Verification](docs/verification.md)
- [Technical contract](docs/contract.md)
- [Architecture](docs/architecture.md)
- [Research](docs/research.md)
- [Source](https://github.com/comp4020-agentic-coding-studio/comp4020-final-Adeeth101)

The source is licensed under AGPL-3.0-or-later. Dependency notices are in [THIRD_PARTY.md](THIRD_PARTY.md).

Run locally with `mise exec -- pnpm dev`. Run the type check and spec suite with `mise exec -- pnpm check`.
