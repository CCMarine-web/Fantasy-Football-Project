# Asset inbox

Drop artwork here, named after its slot in ASSETS.md (`hero-home.png`,
`award-luckiest-win.png`, `card-blake-mire.png`, ...), then run:

    npm run assets:ingest

Each file is cropped, resized and converted to WebP in `public/brand`, the
manifest the site reads is updated, and the original moves to `processed/`.
`npm run assets:status` shows what has arrived and what is still missing.

Nothing in this folder except this README is committed.
