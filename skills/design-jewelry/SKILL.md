---
name: design-jewelry
description: Design a casting-ready ring with someone who makes jewelry, using the flo2-cad tools. Use when a person wants to design, resize, preview, check or export a ring, a solitaire, a bezel or prong setting, or a band for printing and casting. It covers what to ask, units, stone sizes from a grading report, refusals and what to thicken, and platinum.
compatibility: Needs the flo2-cad MCP server, which provides start_piece, change_piece, preview_piece, check_piece, export_for_casting and describe_piece.
---

# Design a ring with a jeweler

Work in the person's terms. Talk about the band, the head, prongs, the bezel, the stone, the girdle and crown, the
ring size, the metal and the caster. Say "the picture", not "the render", and "the ring's recipe", not "the tree".
The tools do the geometry, and your job is the conversation.

## The loop

1. **Find out what they want before you start.**
   - The **ring size and its system**: US, UK or EU. Never guess the system, because "7" is a different ring in each.
   - The **stone**: its shape (round or emerald cut) and its **measured size from its grading report**. A round
     needs its diameter and depth. An emerald cut needs its length, width and depth. The carat weight alone is not
     enough.
   - The **setting**: prongs (4 or 6) or a full bezel.
   - The **metal**: sterling silver, 14k or 18k gold, or platinum 950.
   - The **band**: its profile (comfort fit, half round, flat or round wire), width and thickness.

   You do not need everything first. The tools fill safe defaults and say what is a placeholder.

2. **Start the piece.** Call `start_piece` with a template and the ring size.
   - `solitaire_ring` is a round stone in prongs.
   - `plain_band` is a band with no stone.
   - `emerald_bezel_solitaire` is Emily's design: an emerald cut in a full platinum 950 bezel, set east-west (its long
     side across the finger), on a plain round band.

   Anything else they told you goes in the same call.
3. **Show the picture every time.**
   - `start_piece` and `change_piece` return a preview picture. Show it, and say in a sentence what changed.
   - If the reply says a stone size is a PLACEHOLDER, tell them, and ask for the grading report's numbers.
4. **Change it** with `change_piece` and `set`. Name only what changes, for example
   `{"stone_length": "8.21 mm", "stone_width": "6.02 mm", "stone_depth": "4.05 mm"}`, `{"prong_count": 6}`,
   `{"stone_setting": "bezel"}`, `{"metal": "gold_18k_yellow"}`, or `{"ring_size": {"system": "UK", "size": "N"}}`.
5. **Check it** with `check_piece` when they think it is done, or before you export.
6. **Export it** with `export_for_casting`.
   - You get the STL, a 3MF and the check report. These are the files they send to a caster or print in castable
     resin.
   - The stone is never in the files.

## Units: always millimetres, always written with the unit

- Every measurement you send is a string with its unit: `"1.4 mm"`, never `1.4`, and never inches.
- If the person gives inches or centimetres, convert the number yourself and show them the conversion before you
  send it. For example: "0.25 in × 25.4 = 6.35 mm, so I'll use 6.35 mm."
- A ring size is always `{"system": "US" | "UK" | "EU", "size": ...}`.
- A carat weight is written like `"2.00 ct"`. It is kept for reference only.
- If a call comes back as a malformed call, the message names the exact field and how to fix it. Fix that field and
  call again.

## Stones are sized from what was measured

- Use the numbers on the stone's **grading report** (GIA, IGI and so on): length × width × depth in mm. A round has
  diameter and depth.
- Do not size a stone from a carat chart. Two 2-carat emerald cuts can differ by half a millimetre, and the seat must
  fit this stone.
- Until the real numbers are in, the stone size is a placeholder:
  - the template's typical stone is 6.5 × 4.0 mm for a 1 ct round, or 8.5 × 6.0 × 4.1 mm for a 2 ct emerald cut;
  - every reply and the picture say "placeholder";
  - the checks are only as true as the stone size, so say so.
- The **orientation** of an emerald cut: `east_west` puts its long side across the finger, and `north_south` puts it
  along the finger.

## When the export is refused

A refusal is a normal answer, not an error. The engine refuses to release a file that would not cast. Each limit has
a cited source, and every check runs on the exact file it would have sent.

- The reply says **what to thicken and where**. For example: "Thicken prong 2 of 4 at 4:30: its narrowest section
  is 0.47 mm, where the seat for the stone is cut, and it needs 1.0 mm."
- Positions are clock positions seen from above, with the finger pointing to 12 o'clock.
- Tell the person plainly and offer the change the reply suggests. Make it with `change_piece`, show the new
  picture, and check again.

The limits, so you can explain them:

| Limit | Value |
|---|---|
| Walls (and the bezel rim) | at least 0.8 mm |
| Ring band | at least 1.0 mm thick |
| Each prong at its narrowest | at least 1.0 mm, because a prong is held at one end only |
| Details | at least 0.35 mm |
| Gaps | at least 0.3 mm, or 0.8 mm in platinum |
| The surface | within 0.01 mm of the intended shape |
| A bezel lip | covers 50 % to 75 % of the stone's crown |
| Each prong's reach over the girdle | at least 0.15 mm |

A **too-thin prong or bezel can still be drawn and previewed**. It just will not export. Previews are never refused.

## Platinum

- Platinum 950 melts at about 1780 to 1795 °C and is cast at about 1850 to 2200 °C, with special investment and an
  induction caster.
- So a platinum piece goes to a **specialist platinum caster**, not a home or local silver-and-gold setup. Every
  platinum reply says so, and you should say it too before they order.
- Silver and gold can be cast at home or locally (castable resin or lost wax).

## Shrinkage

- Metal shrinks about 1 to 1.5 % in casting.
- The allowance is per piece and off by default: `"shrinkage": "on"` uses the metal's figure (1.5 %), or give one
  such as `"1.2 %"`.
- Every export says whether it was applied. Ask the caster before turning it on: many casters compensate themselves.

## Picking up later

- Each change returns the ring's recipe (its tree), and flo2 keeps every version as `<name>.tree.json`.
- To continue in a new conversation, pass that tree as `tree` to any tool.
- `describe_piece` reads the piece back in jeweler's terms: its size, weight in each metal, and every setting you can
  change.
