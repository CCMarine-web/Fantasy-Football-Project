# The Rat Trap: Image and Asset Plan

Everything the site could use in the way of artwork: what each piece is, where it goes, its exact size, and a ready-to-paste ChatGPT prompt. The site already shows a tasteful placeholder in every one of these spots, so art can arrive one piece at a time, in any order.

**Ground rules**

- **No text in any image.** No words, letters, numbers, jersey numbers, logos or watermarks. Every prompt says so; reject any output that sneaks some in. Names, scores and labels are always real text on the page.
- **No AI icons.** Icons come from the icon library the site already uses (Lucide). The logo and favicon are the vector rat mark, drawn in code.
- **League photos stay.** The real photos behind each page are better than anything generated, and they stay.

---

## How art gets onto the site

1. Generate the image in ChatGPT with the prompt below, choosing the shape it lists (Square, Landscape or Portrait).
2. Save it with the **exact filename** in the table, for example `hero-home.png`. PNG, JPG or WebP all work. Case, spaces and a trailing " (1)" don't matter.
3. Drop it in **`/asset-inbox`**.
4. Run **`npm run assets:ingest`**. Each file is cropped to the slot's shape around its most interesting area, resized, converted to WebP, saved to `/public/brand` under a cache-safe name, and recorded in `src/lib/brand-assets.manifest.json`. The original moves to `asset-inbox/processed`.
5. Commit `public/brand` and the manifest, then deploy. The placeholder in that spot is replaced; no code changes.

Other commands:

- `npm run assets:status` lists what's in place and what's missing, by priority.
- `npm run assets:ingest -- --remove card-blake-mire` takes one back out.

Cut-out art (marked **transparent**) must come back as a PNG with a transparent background; the script warns you if it didn't. Ask again with "transparent background, PNG" if needed.

---

## Choose an art direction

All three keep the site's look (near-black with light blue `#41b0eb`, no gold). Pick one. The prompts below are written for **A**; if you choose B or C, I'll rewrite them.

### A. Tabloid Halftone — recommended

A two-ink risograph print: the back page of a gritty sports tabloid. Near-black ink and one spot colour, the site's light blue, with paper-white highlights used sparingly. Coarse halftone dots for shading, slight misregistration, paper grain, bold silhouettes, dramatic angles. The league's rats become cartoon-noir characters: scrappy, cocky and expressive.

*Why it's the pick:*

- **Two inks are on-brand by construction.** Every image matches the site with no colour correction.
- **It's the easiest look to keep consistent** across 40-odd generations.
- **It reads at thumbnail size** on a phone.
- **It matches the paper the site already is** ("weekly issues", the news desk).
- **Mugshots and trading cards are native to print.**
- **It looks made on purpose**, not glossy-AI.

> Sample: *Two-colour halftone risograph print, back page of a gritty sports tabloid; only near-black ink and electric light blue (#41B0EB) with sparing off-white highlights; coarse halftone shading, slight misregistration, paper grain. A cocky cartoon rat in a football jersey and eye-black, mid-sprint with a football tucked under its arm, low dramatic angle, stadium floodlights behind. No text, letters, numbers or logos.*

### B. Neon Arena

Cinematic 3D renders: a dark stadium at night, volumetric blue light, haze, rim-lit rat mascots with glossy materials. Punchy and heroic, and the most "trailer-like".

*Trade-offs:*

- **The most generic AI look**, and the same rat is hard to keep consistent from image to image.
- **Busy images** fight the text laid over them.
- **Heavier files.**

> Sample: *Cinematic 3D render, dark football stadium at night, volumetric electric-blue (#41B0EB) light beams and haze, a muscular cartoon rat mascot in a black jersey and helmet bursting through smoke holding a football, rim lighting, shallow depth of field, near-black shadows. No text, letters, numbers or logos.*

### C. Vintage Trading Card

Painted gouache illustration in the style of 1970s football cards and NFL Films. Worn card stock and film grain, retinted to charcoal and blue. Nostalgic and great for the manager cards.

*Trade-offs:*

- **The vintage palette pulls warm.** It needs constant steering to stay blue-on-dark.
- **It reads gentler and less unhinged** than the new voice.

> Sample: *Painted gouache illustration in the style of a 1970s football trading card, worn card stock texture and film grain, palette limited to charcoal, slate and light blue (#41B0EB) with cream highlights. A scrappy cartoon rat quarterback in a vintage leather helmet dropping back to pass, muddy field, overcast stadium. No text, letters, numbers or logos.*

---

## Style block (direction A)

Paste this at the start of every prompt, or once at the start of a ChatGPT conversation with "use this style for every image in this chat".

```
STYLE: two-colour halftone risograph print, like the back page of a gritty
sports tabloid. Only two inks: deep near-black (#0B0F14) and electric light
blue (#41B0EB), with off-white paper (#E8F4FB) highlights used sparingly.
Coarse halftone dots for shading, slight ink misregistration, subtle paper
grain. Bold graphic silhouettes, heavy shadows, dramatic angles. Characters
are cartoon-noir rats: scrappy, cocky, expressive. ABSOLUTELY NO text,
letters, numbers, jersey numbers, logos, signage or watermarks anywhere.
```

For **transparent** pieces, add:

```
Isolated cut-out on a fully transparent background (PNG with alpha): no
backdrop, no floor, no frame, nothing touching the edges, generous margin.
```

**Consistency tips**

- Make `hero-home` first and keep that chat open: "Same style and same rat characters as the first image" keeps everything after it matched.
- Do all ten manager cards in one chat, then all ten mugshots in another.

---

## Shot list

Output sizes are what the site serves; generate at the ChatGPT shape listed and the script crops to fit. **P1** pieces change how the site feels; **P2** is polish.

### Pages

| File | Where it appears | Output | ChatGPT shape | Transparent | Priority |
|---|---|---|---|---|---|
| `hero-home.png` | Homepage, behind the masthead on desktop, a strip above it on phones | 1536×640 (12:5) | Landscape | No | P1 |
| `empty-trap.png` | Every empty state ("no games yet", "nothing here") | 512×512 | Square | **Yes** | P1 |
| `not-found.png` | 404 page | 768×768 | Square | **Yes** | P2 |

**hero-home** — *Landscape.*
> [Style block] A gang of scrappy rats in football gear storming out of a dark stadium tunnel under blinding floodlights; the leader at the front holds a football aloft, the rest snarl and grin behind. Low, epic angle. Wide composition: the action fills the right 60% of the frame; the left 40% is calm, dark, empty shadow (text will sit there). Keep everything important in the middle horizontal band. No text, letters, numbers or logos.

**empty-trap** — *Square, transparent.*
> [Style block] [Transparent block] A classic wooden snap rat trap, set and empty, with a small wedge of cheese on the trigger, seen from a slight three-quarter angle, a single blue rim light. Nobody around. No text.

**not-found** — *Square, transparent.*
> [Style block] [Transparent block] A small, worried cartoon rat in a football jersey holding a flashlight and a torn, blank map, looking around lost. No text.

### Championship

| File | Where it appears | Output | ChatGPT shape | Transparent | Priority |
|---|---|---|---|---|---|
| `belt.png` | Championship Belt page and the homepage belt feature when there's no trophy photo | 1200×800 (3:2) | Landscape | **Yes** | P1 |

**belt** — *Landscape, transparent.*
> [Style block] [Transparent block] A heavyweight championship belt laid flat, front on: a huge ornate centre plate embossed with a rat's-head-in-profile emblem, flanked by smaller side plates with football motifs, studded with light-blue gems, thick black leather strap. Plates are completely blank of text and numbers. No text.

### Weekly awards

Badges shown beside each weekly award. Square, transparent, all **P1**, output 512×512. Make all five in one chat so they match as a set.

| File | Award |
|---|---|
| `award-boom-of-week.png` | Boom of the Week |
| `award-bust-of-week.png` | Bust of the Week |
| `award-bench-blunder.png` | Bench Blunder |
| `award-luckiest-win.png` | Luckiest Win |
| `award-unluckiest-loss.png` | Unluckiest Loss |

Start each with: *[Style block] [Transparent block] A circular emblem badge, like an enamel pin, with a thick blue rim and no text, containing:*

- **boom-of-week**: a rat riding a football like a rocket, flames and an explosion burst behind it.
- **bust-of-week**: a rat deflating along with a flat, punctured football, one sad hiss of air.
- **bench-blunder**: a rat fast asleep on a sideline bench while glowing footballs spill off the bench beside it.
- **luckiest-win**: a smug rat holding a four-leaf clover and a horseshoe, sparkles around it.
- **unluckiest-loss**: a soaked, furious rat under its own personal storm cloud, lightning striking just beside it.

### Hall of Shame

| File | Where it appears | Output | ChatGPT shape | Transparent | Priority |
|---|---|---|---|---|---|
| `sacko.png` | Hall of Shame, beside "Last Place by Season" | 768×768 | Square | **Yes** | P1 |

**sacko** — *Square, transparent.*
> [Style block] [Transparent block] The league's last-place "trophy": a rusty, sprung rat trap mounted on a cheap, chipped plastic trophy base, a single fly buzzing above it, one sad spotlight. The plaque on the base is completely blank. No text.

### Section headers

Wide banners above each page title, served at 1536×512 (3:1). Generate as **Landscape**: compose as a wide panorama with the subject in the middle horizontal band, because the top and bottom are cropped. Not transparent.

Each prompt starts with: *[Style block] Wide panoramic scene, subject in the middle horizontal band, dark edges top and bottom.*

| File | Priority | Scene |
|---|---|---|
| `header-hall-of-shame.png` | P1 | A dim museum corridor lined with framed portraits of miserable rats, one cold spotlight on an empty plinth at the end. Frames hold pictures only; no plaques, no text. |
| `header-trade-tribunal.png` | P1 | A rat judge in a powdered wig slamming a gavel at a towering courtroom bench while two rats below argue over a pile of blank trading cards. |
| `header-power-rankings.png` | P1 | Rats on a staircase of stacked shipping crates under a spotlight, the top rat flexing and the bottom rat slumped. |
| `header-rivalries.png` | P1 | Two rats nose to nose at a boxing-style weigh-in, sparks crackling between them, camera flashes behind. |
| `header-matchups.png` | P2 | Two rat teams crouched at the line of scrimmage under stadium lights, low angle along the line. |
| `header-standings.png` | P2 | Rats scrambling up a giant ladder against a night sky, some near the top, one dangling from the bottom rung. |
| `header-records.png` | P2 | A dusty archive of trophies and towering shelves, a rat on a rolling ladder reaching for a glowing, closed record book. |
| `header-history.png` | P2 | A rat with a magnifying glass studying a wall of old framed team photos (pictures of rats in vintage uniforms; no captions). |
| `header-managers.png` | P2 | A sideline lineup of rat coaches in headsets and hoodies, arms crossed, under floodlights. |
| `header-draft-report-cards.png` | P2 | Rats crowded around a war-room table covered in blank player cards, one rat on the table shouting into a phone. |
| `header-predictions.png` | P2 | A rat fortune teller hunched over a crystal ball with a football glowing inside it, smoke curling. |
| `header-news.png` | P2 | A rat newsie hurling a rolled-up newspaper (no visible print) from a rooftop, a printing press glowing behind. |
| `header-championship-belt.png` | P2 | A battered rat in a boxing ring holding a championship belt overhead, crowd silhouettes and flashbulbs. |

### Managers

One trading card and one mugshot per manager. Use the manager's photo as the likeness reference: attach the photo in ChatGPT; the site's copies are in `/public/managers`. Not transparent.

- **Card**: `card-<name>.png`. Shown on the manager's profile beside their name. Output 1000×1400 (5:7). Generate as **Portrait**. **P1.**
- **Mugshot**: `mugshot-<name>.png`. Shown in the Hall of Shame next to each last-place finish. Output 1024×1280 (4:5). Generate as **Portrait**. **P2.**

Files for each manager:

| Manager | Card | Mugshot |
|---|---|---|
| Anthony Cibilich | `card-anthony-cibilich.png` | `mugshot-anthony-cibilich.png` |
| Blake Mire | `card-blake-mire.png` | `mugshot-blake-mire.png` |
| Ethan Jones | `card-ethan-jones.png` | `mugshot-ethan-jones.png` |
| Gavin Detillier | `card-gavin-detillier.png` | `mugshot-gavin-detillier.png` |
| Logan Javier | `card-logan-javier.png` | `mugshot-logan-javier.png` |
| Michael Barkemeyer | `card-michael-barkemeyer.png` | `mugshot-michael-barkemeyer.png` |
| Michael Shea | `card-michael-shea.png` | `mugshot-michael-shea.png` |
| Patrick McManus | `card-patrick-mcmanus.png` | `mugshot-patrick-mcmanus.png` |
| Patrick Schwing | `card-patrick-schwing.png` | `mugshot-patrick-schwing.png` |
| Quinn Fuentes | `card-quinn-fuentes.png` | `mugshot-quinn-fuentes.png` |

**Card** — *Portrait, with the photo attached.*
> [Style block] Using the attached photo only as the likeness reference, a heroic trading-card portrait of this person as a fantasy football manager: chest-up, three-quarter view, confident smirk, dark hoodie and a sideline headset, holding a clipboard. Background is a light-blue halftone burst. Framed by a thin light-blue card border with rounded corners. No name banner, no text, no numbers, no logos.

**Mugshot** — *Portrait, with the photo attached.*
> [Style block] Using the attached photo only as the likeness reference, a police booking photo of this person: front-facing, deadpan and unimpressed, harsh flash lighting, holding a completely blank dark placard at chest height. Behind them, plain horizontal height-chart lines with no numbers. No text, no numbers, no logos.

A manager marked **no-roast** never gets a mugshot shown, even if the file is supplied.

---

## Made in code (nothing to generate)

| What | How |
|---|---|
| Favicon, app icon, Apple touch icon | Drawn from the vector rat mark (`app/icon.svg`, `app/apple-icon.tsx`, `app/favicon.ico`). Crisp at 16px, where an illustration would turn to mush. |
| Link previews (Open Graph) | Generated per page with `next/og` in the site's colours:<br>• the homepage<br>• matchups (both teams, and the score only once final)<br>• managers (record and titles)<br>• seasons (champion, runner-up, regular-season No. 1)<br>• rivalries<br>• weekly issues<br>• power rankings<br>• the Trade Tribunal<br>Every other page uses the homepage card. Real text, always current, never AI art. Code in `src/lib/og` and each route's `opengraph-image.tsx`. |
| Icons | Lucide, already in the site. |
| Page backgrounds | The league's own photos, already in place. |
| Placeholders | A light-blue halftone screen with a Lucide icon, matching direction A, or the existing photo where there is one. |
