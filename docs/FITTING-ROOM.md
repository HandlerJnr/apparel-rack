# Fitting room v1

The Wear it action opens a native modal dialog showing a locally rendered WebGL character in the selected garment. It uses the front product photograph for front-surface texture and samples its fabric colour for the illustrated sleeves, sides and back. Character shape and skin tone can be changed without uploading a photo. Drag, arrow keys, a rotation slider and auto-turn provide 360-degree viewing. Zoom and front-view reset are available.

This is a styling prototype, not a measured fit recommendation or AI-generated photograph. Unseen back/side construction is illustrative. Real personal-photo try-on requires a selected provider, server-side credentials, an explicit image-upload flow, and a defined photo retention/deletion policy. It is not simulated here.

If WebGL is unavailable, the product photograph and a clear fallback message remain available. The product detail view and bag stay separate from the fitting room. Checkout stays local with a preview-mode message; no payment service is configured and no template purchase link remains.

Review on desktop and a real phone before release. Phone emulation verifies layout; it does not replace touch-device testing.
