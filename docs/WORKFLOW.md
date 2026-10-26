# Preview-first workflow

1. Create a feature branch from the current baseline.
2. Make a focused change; keep catalogue, geometry metadata and image IDs in sync.
3. Run `npm run check`, `npm test` and `npm run build`.
4. Push the branch and create a Vercel Preview for its exact commit.
5. Review desktop, phone, keyboard and reduced-motion behaviour.
6. Merge only after review. Production publishing is a separate, explicit step.

## Current review checklist

- Rail appears with all ten garments and all front/side assets.
- Hover and drag feel soft and remain anchored to the hanger.
- Mobile vertical gestures scroll rather than becoming cloth drags.
- A horizontal drag or hold does not accidentally open a product.
- Normal taps and keyboard activation open product details.
- Product sizes, stock states, bag quantities and subtotal work.
- Closing overlays restores page scrolling and focus.
- No live payment or newsletter backend is configured.
