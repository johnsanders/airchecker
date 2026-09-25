# Reference frames — DD26 package (September 2026)

Calibration and prompt-authoring source of truth for the current on-air look. Committed on purpose (see `.gitignore`).

**Source video:** `recordings/video/air_example.mp4` (gitignored, 448 MB, 6:48 at 1920×1080/29.97). The PNGs below were cut from it with `ffmpeg -ss <t> -i air_example.mp4 -frames:v 1 <name>.png`. Not pixel-accurate — the real graphics may sit a few pixels off, so `captureRegion`s carry slack.

**Race keys:** the air `raceKey` is the printed heading, upper-cased, with the `|` divider and repeated spaces removed (`VA | GOVERNOR` → `VA GOVERNOR`), because the model renders the divider inconsistently.

**Ground truth below was transcribed by Claude from the frames on 2026-09-25 and is mock data. Verify against the frame before using a row as a golden's expected value.** Vote totals in the ticker carry thousands separators; the lower-third and fullscreen mockups do not.

## Layout facts (normalized to frame height)

| Surface | Band (y) | Notes |
| --- | --- | --- |
| ticker | 0.885 – 0.985 | Always on air during election coverage; a ~20 s promo bar sometimes takes its slot. No graphics detected = programming we don't monitor. Flips every ~10 s (vertical wipe). Heading `ST \| OFFICE (P)` with optional `DISTRICT n` second line. `>95% IN` is the normal display at ≥95. |
| results lower-third | 0.685 – 0.89, x 0.19 – 0.955 | Replaces the headline chyron in the same band; NewsNation bug stays bottom-left. |
| fullscreen board | 0 – 0.68 | Headline chyron stays visible beneath it, ticker below that. `% IN` badge top-right above the DD26 bug — always present; absence is a display bug. A "DDHQ PROJECTION" band may or may not appear beneath the cards; it is not a call signal. |

## Frames cut from the video

| File | t (s) | Surfaces expected | Ticker | Lower-third / fullscreen |
| --- | --- | --- | --- | --- |
| `ticker-tx-senate-d.png` | 10 | ticker | TX \| U.S. SENATE (D), >95% IN — D James Talarico ✓ 52.4% 1,216,412; D Jasmine Crockett 46.2% 1,071,900 | chyron: DEVELOPING STORY / BANNED OUTLETS ALLOWED BACK ON WH GROUNDS (ignore) |
| `ticker-va-governor.png` | 33 | ticker | VA \| GOVERNOR, >95% IN — D Abigail Spanberger ✓ 57.7% 1,976,857; R Winsome Earle-Sears 42.3% 1,449,586 | chyron: GERALDO RIVERA name super (ignore) |
| `ticker-ct-house-d-1.png` | 62 | ticker | CT \| U.S. HOUSE (D) / DISTRICT 1, 84% IN — D Luke Bronin ✓ 54.3% 29,658; D John Larson 32.8% 17,933 | chyron: WH RESTORES ACCESS FOR BANNED NEWS OUTLETS (ignore) |
| `ticker-wi-house-d-7.png` | 380 | ticker | WI \| U.S. HOUSE (D) / DISTRICT 7, >95% IN — D Fred Clark ✓ 37.7% 25,492; D Ginger Murray 31.9% 21,603 | chyron: DELEGATES WALK OUT ON NETANYAHU'S UN SPEECH (ignore) |
| `ticker-midflip.png` | 14.9 | none (missed capture) | TX Senate (D) → (R) wipe in progress | — |
| `l3-al2-house.png` | 6 | lower_third + ticker | TX \| U.S. SENATE (D) as above | L3: AL-2 / U.S. HOUSE, 76% IN — D Shomari Figures 34.0% 234234; R Rhett Marques ✓ 66.0% 4233432 (placeholder elephant headshot) |
| `l3-ak-senate.png` | 17 | lower_third + ticker | TX \| U.S. SENATE (R), >95% IN — R Ken Paxton ✓ 63.8% 885,949; R John Cornyn 36.2% 501,725 | L3: AK / U.S. SENATE, 43% IN — D Mary Peltola 87.0% 448293; R Dan Sullivan 13.0% 22453 |
| `l3-az-house.png` | 28 | lower_third + ticker | VA \| GOVERNOR as above | L3: AZ / U.S. HOUSE (no district), 45% IN — D Amish Shah 30.0% 2368978; R Jay Feely 70.0% 493809 |
| `l3-al-governor.png` | 46 | lower_third + ticker | VA \| ATTORNEY GENERAL, >95% IN — D Jay Jones ✓ 53.4% 1,804,940; R Jason Miyares 46.6% 1,577,843 | L3: AL / GOVERNOR, 76% IN — D Doug Jones 45.0% 289982; R Tommy Tuberville 54.0% 393720 |
| `l3-ar-senate.png` | 66 | lower_third + ticker | CT \| U.S. HOUSE (D) / DISTRICT 1 as above | L3: AR / U.S. SENATE, 34% IN — D Hallie Shoffner 60.5% 292309; R Tom Cotton 40.2% 424234 |
| `l3-al-senate.png` | 366 | lower_third + ticker | WI \| GOVERNOR (D), >95% IN — D David Crowley ✓ 39.8% 315,474; D Francesca Hong 39.3% 311,616 | L3: AL / U.S. SENATE, 84% IN — D Everett Wess 45.1% 19223; R Barry Moore 55.8% 33212 |
| `fs-fl-governor.png` | 85 | fullscreen + ticker | MN \| GOVERNOR (R), >95% IN — R Lisa Demuth ✓ 43.4% 179,714; R Mike Lindell 32.5% 134,326 | FS: FL GOVERNOR, >95% IN — D David Jolly 62.0% 3783929; R Byron Donalds 48.0% 2729283; no ✓. chyron beneath (ignore) |
| `fs-ma-senate.png` | 108 | fullscreen + ticker | MN \| U.S. SENATE (D), >95% IN — D Peggy Flanagan ✓ 59.0% 411,797; D Angie Craig 39.4% 274,891 | FS: MA U.S. SENATE, 68% IN — D Edward Markey 51.0% 37923; R John Deaton 49.0% 36784 |
| `fs-me-senate.png` | 260 | fullscreen + ticker | CT \| GOVERNOR (D), 87% IN — D Ned Lamont ✓ 67.8% 126,078; D Josh Elliott 32.2% 59,980 | FS: ME U.S. SENATE, 68% IN — D Troy Jackson 51.0% 37923; R Susan Collins 49.0% 36784 |
| `fs-ks-governor.png` | 340 | fullscreen + ticker | SC \| U.S. SENATE (R), >95% IN — R Darline Graham ✓ 33.0% 109,881; R Ralph Norman ✓ 24.8% 82,628 (**two ✓ — an error this cycle; must raise `multiple_winners`**) | FS: KS GOVERNOR, >95% IN — D Cindy Holscher 62.0% 3783929; R Ty Masterson 48.0% 2729283 |
| `fs-mi-senate.png` | 386 | fullscreen + ticker | WI \| U.S. HOUSE (D) / DISTRICT 7 as above | FS: MI U.S. SENATE, 68% IN — D Abdul El-Sayed 51.0% 37923; R Mike Rogers 49.0% 36784 |
| `fs-fl22-house-no-pctin.png` | 170 | fullscreen (pct_in **missing** → `field_missing` alert) + ticker | WI \| GOVERNOR (R), >95% IN — R Tom Tiffany ✓ 95.4% 467,745; R Andy Manske 4.6% 22,546 | FS: FL-22 U.S. HOUSE, **no % IN badge** — D Pia Dandiya 32.0% 373632; R Casey Askar 66.0% 827282. chyron: BREAKING NEWS / BENJAMIN NETANYAHU |
| `neg-breaking-news-chyron.png` | 175 | ticker only | WI \| U.S. HOUSE (D) / DISTRICT 7 as above | chyron: BREAKING NEWS / BENJAMIN NETANYAHU / ISRAELI PRIME MINISTER — must NOT be reported as a results graphic |
| `neg-name-super-chyron.png` | 22 | ticker only | TX \| U.S. SENATE (R) as above | chyron: DEVELOPING STORY / GERALDO RIVERA / NEWSNATION CORRESPONDENT-AT-LARGE — must NOT be reported |
| `neg-promo-chyron-the-hill.png` | 52 | ticker only | CT \| GOVERNOR (D) as above | blue promo chyron: TONIGHT 6p/5C / THE HILL WITH BLAKE BURMAN, with a headshot — must NOT be reported |
| `neg-promo-bar-no-ticker.png` | 195 | none (empty result — not monitored) | promo bar FOR MORE INFO, GO TO NEWSNATIONNOW.COM occupies the ticker slot | chyron DELEGATES WALK OUT — must NOT be reported |

## Frames from graphics-team exports (converted from JPG)

| File | Surfaces expected | Contents |
| --- | --- | --- |
| `fs-ma-senate-called.png` | fullscreen (called) | FS: MA U.S. SENATE, 68% IN — D Edward Markey ✓ 51.0% 37923; R John Deaton 49.0% 36784. The only fullscreen with a ✓. "DDHQ PROJECTION" band visible beneath (no chyron in this export). Source: `example_fs_winner.jpg`. |
| `ticker-va-governor-uncalled.png` | ticker (uncalled) | VA \| GOVERNOR, >95% IN — D Abigail Spanberger 57.7% 1,976,857; R Winsome Earle-Sears 42.3% 1,449,586; **no ✓**. Keyed over color bars. Source: `ticker_no_winner.jpg`. |

## Other files

- `ticker.png` — VA Governor ticker keyed over color bars (graphics-team export). Same data as the VA GOVERNOR row above.
- `fs-2.png`, `fs-3.png` — all-three composites (fullscreen + RACE ALERT-style lower-third + ticker) built for convenience; the stacked case is possible but rare.
- `example_fs_winner.jpg`, `ticker_no_winner.jpg` — originals of the two converted frames above.
- `example_*_L3 *.jpg`, `example_*_FS *.jpg` — Photoshop layer exports of the lower-third and fullscreen designs on white. Prompt-authoring references only: they are JPEG, the lower-thirds sit lower than on air, and two are duplicates (`L3 5` = `L3 7`).

## Still wanted

Every race is shown as exactly two candidates in this package, so no multi-candidate variants are needed. Side slab is gone for this cycle (may return). The frame set is complete as of 2026-09-25. The "DDHQ PROJECTION" band beneath the fullscreen cards may or may not be present; it is decoration, not a call indicator — only the ✓ on a card means called.
