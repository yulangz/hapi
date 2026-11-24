# HAMLET brand assets

Canonical HAMLET icon source used by the web, documentation, website, Android,
and iOS applications.

## Design decisions

- Face, symmetric eyes, smile, coral palette, and rounded robot frame retained.
- Side nodes become mirrored angle-bracket ports: `< HAMLET >`.
- The brackets carry two meanings without touching the face: developer/code
  context and local ↔ remote handoff direction.
- Directional negative space changes the port structure, rather than merely
  swapping a circle for another primitive.
- Endpoint cutouts are true transparency and survive monochrome use.
- The PWA maskable master reuses the same optical geometry at a uniform smaller
  scale so every handoff port remains inside the maskable safe area.
- iOS and installed PWA surfaces retain the robot mark while using its existing
  small-size optical corrections: slightly stronger frame, eyes, smile, and
  handoff ports, without the eye highlights that refract on iOS 26.
- The iOS 26 Icon Composer package renders the coral mark as one flat,
  non-glass foreground over Warm White; it does not introduce a second logo.
- 16 px uses simplified solid brackets; 32 px and above retain the negative
  angle-bracket ports.
- Horizontal lockup canvas remains tightened; no terminal-cursor treatment.

## Palette

- HAMLET Coral: `#F25562`
- Warm White: `#FFF8F8`
- White: `#FFFFFF`
- Ink: `#17181C`

## Source SVGs

- `svg/hamlet-mark.svg` — transparent primary brand mark.
- `svg/hamlet-app-icon.svg` — full-bleed app icon master.
- `svg/hamlet-optical-mark.svg` — transparent iOS launcher foreground matching
  the small-size optical geometry.
- `svg/hamlet-tiny.svg` — simplified 16 px favicon master.
- `svg/hamlet-small.svg` — optically corrected 24–64 px master.
- `svg/hamlet-maskable.svg` — safe-area-scaled PWA optical master.
- `svg/hamlet-adaptive-foreground.svg` — Android adaptive foreground master.
- `svg/hamlet-monochrome.svg` — one-color mark.
- `svg/hamlet-lockup-horizontal.svg` — tightened horizontal lockup.

## Sync platform assets

```bash
./assets/brand/export.sh
```

The script renders into a temporary directory, then updates only the files used
by `web/`, `docs/`, `website/`, `android/`, and `ios/`. Generated intermediates
are deliberately not stored in the repository.

Android adaptive, themed, and notification icons remain native VectorDrawable
resources under `android/app/src/main/res/`; keep them aligned with
`svg/hamlet-adaptive-foreground.svg` when changing the geometry.
