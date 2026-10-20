# Crit 10 reflection: Fly by instruments

## What was the breakthrough that moved the work forward?

The breakthrough was realising that my app already told people apart, but only to itself. Ownership and revision checks had been on the server since crit 9, and two browsers really were two people, yet the only thing the server ever printed was "listening on 8080". If someone in my pod had tried to change another person's track, the server would have refused it correctly and I would have had no way to say so.

The fix was small once I saw where to put it: log at the two places a change becomes real, after commit, rather than scattering log calls through every handler (cf626ea). The bigger shift was deciding that refusals belong in the log too. A line like "slow echo tried to rename Drums, owned by low cloud: 403" is the clearest evidence that my permission rules work, and it is exactly what I want to narrate. Running it with two Chrome profiles showed I could tell the whole story from the log alone.

## What did this work change about who I want to be as a software developer?

I used to think of logging as something you add when a bug turns up. This week it became part of the design: if I can't see who did what in production, I can't claim my rules hold for real people, only for my tests. I want to build systems that can explain themselves after the fact, and to treat "how will I know this worked when I'm not watching?" as a question I ask before shipping, not after.
