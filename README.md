# Apparel Rack

An interactive apparel storefront with a physics-driven rail, spring cloth movement in the product grid, touch interaction, product details and a demo shopping bag.

**Status: design prototype. Preview first; no production release authorised.**

## Run locally

Requires Node.js 20 or newer. The project has no runtime or build dependencies.

```sh
npm run check
npm test
npm run build
npm run preview
```

Open http://localhost:4173. `npm run dev` builds and serves in one command; rerun the build after editing.

## Structure

- `src/index.html`: semantic page, product details and bag markup
- `src/styles/main.css`: layout, responsive styles and interaction styles
- `src/scripts/catalogue.js`: demo product data and measured garment geometry
- `src/scripts/app.js`: rail physics, rendering, product view and shopping bag
- `src/scripts/drop-motion.js`: product-grid spring motion and touch gestures
- `public/img/garments/`: twenty front/side garment images
- `scripts/`: dependency-free build, preview server and validation
- `tests/`: interaction checks for product-grid motion
- `docs/`: interaction notes and release workflow

## Review and release

`main` is the baseline. Work happens on `preview` or feature branches. Review a Vercel **Preview** deployment before merging or releasing. Automatic deployment from `main` is disabled in `vercel.json`. Production deployment or promotion requires an explicit release decision.

## Demo behaviour

- Rail: hover turns a garment; drag swings it. Touch uses the reference's tap-to-turn flow.
- Drop: hover gives the cloth a swing; horizontal dragging plays with it. On phones, hold to jiggle or slide sideways; normal taps open details and vertical gestures scroll.
- Reduced-motion users retain product access without the grid spring animation.
- The bag is in memory. Checkout displays an in-project preview notice; no payments or template-purchase redirects are enabled.
- Wear it opens an illustrative 3D character preview with drag-to-turn, shape and tone controls, zoom and garment switching. It is not personal-photo AI try-on or a measured fit recommendation. See `docs/FITTING-ROOM.md`.
- The newsletter validates an address but sends and stores nothing.

## Reference and assets

This private development prototype currently reproduces Hangtime Apparel at https://ecom-apparel.whop.site/ as a visual and interaction baseline. The source design, product copy and garment imagery are reference material, not original brand assets. No licence to those materials is asserted. See `docs/REFERENCE.md` for provenance and the custom work added here. Replace the reference brand and assets before an independently branded public launch.
