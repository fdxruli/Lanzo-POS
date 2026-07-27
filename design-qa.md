# Design QA — Ecommerce público

- Source visual truth: `C:\Users\pituf\.codex\generated_images\019f9c18-196f-7af2-8b90-539881a2872d\call_nEIXM8Y1yxlK2H39cYVdbpP3.png`
- Main implementation screenshot: `C:\dev\Lanzo-POS-Git\artifacts\public-store-redesign-grid-target-843x1844.png`
- Full comparison: `C:\dev\Lanzo-POS-Git\artifacts\public-store-redesign-comparison.png`
- Mobile grid: `C:\dev\Lanzo-POS-Git\artifacts\public-store-redesign-grid-mobile.png`
- Mobile list: `C:\dev\Lanzo-POS-Git\artifacts\public-store-redesign-list-mobile.png`
- Compact footer, mobile: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-mobile.png`
- Compact footer, desktop: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-desktop.png`
- Footer before/after: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-before-after.png`
- Source pixels: 853 × 1844
- Main implementation pixels: 843 × 1822
- Main CSS viewport: 853 × 1844 at device scale factor 1; the 10 px width difference is the browser scrollbar
- Mobile CSS viewport: 390 × 844 at device scale factor 1
- Footer desktop CSS viewport: 1280 × 800 at device scale factor 1
- State: real Farmacia Gary Chrome portal, current personalized dark theme, eight real catalog products

## Full-view comparison evidence

The implementation preserves the selected direction: compact business identity, operational status and address, delivery methods, search and categories before the catalog heading, a prominent grid/list control, and a dense product-first layout. The current dark palette is an intentional portal customization; Free and Pro storefronts continue to use the same theme variables.

The rendered implementation uses three columns at the 843 px breakpoint instead of the concept's four because the real catalog contains longer product names and purchase controls. Mobile uses two columns in grid mode and one readable row per product in list mode.

## Focused comparison evidence

- Grid/list: both buttons were located from the rendered accessibility tree, each resolved uniquely, and `aria-pressed` changed correctly after interaction.
- Product cards: the first pass compressed price and availability text beside the action button. The footer inside each grid card now uses a vertical flex layout, so price, stock state, and the full-width action remain readable.
- Promotional footer: the previous mobile block occupied roughly 280 px and used a full-width button. The revised footer is a single secondary strip of roughly 56 px on mobile, with a small brand mark, one-line attribution, and a text link. Desktop keeps one short explanatory line without becoming a second hero.

## Required fidelity surfaces

- Fonts and typography: existing Lanzo font stack and optical hierarchy preserved; footer typography was reduced to 0.72–0.82 rem.
- Spacing and layout rhythm: header and catalog are materially denser; footer padding is 0.7–0.85 rem and no longer creates a large terminal section.
- Colors and tokens: all surfaces continue to use portal theme and UI semantic tokens. The light-vs-dark difference from the concept is intentional personalization.

## Footer and cart follow-up

- Source mobile: `C:\Users\pituf\AppData\Local\Temp\codex-clipboard-eb167e11-3da5-4020-9761-e161b4d9d43c.png` (274 x 558)
- Result mobile: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-mobile-final-274x558.png` (274 x 558)
- Mobile comparison: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-mobile-comparison-final.png`
- Source desktop: `C:\Users\pituf\AppData\Local\Temp\codex-clipboard-24b9ef1f-2d9b-49e1-83d6-a85735b68169.png` (900 x 562)
- Result desktop: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-desktop-final-900x562.png` (900 x 562)
- Desktop comparison: `C:\dev\Lanzo-POS-Git\artifacts\public-store-footer-desktop-comparison-final.png`
- Mobile with an active cart: the attribution footer is hidden, leaving the fixed cart action as the only bottom element.
- Desktop and tablet from 42 rem: the attribution is a compact content-width capsule aligned left and the 24 rem cart action floats right on the same baseline.
- Measured at 900 x 562: footer `x=24`, `width=345.42`; cart `x=482`, `width=384`; overlap is false.
- The explanatory footer copy and full-width background were removed. Theme tokens and Free/Pro personalization remain unchanged.

final result: passed

---

# Public order tracking redesign (option 1)

- Source visual truth: `C:\Users\pituf\.codex\generated_images\019fa0a7-b19d-7403-a0c1-e253f6214019\exec-9ff79c17-2db3-4342-a668-b046f08f7f40.png`
- Intended viewports: desktop 1440 × 1024; mobile below 672px.
- Target state: paid delivery order in `preparing`.

## Findings

- [P1] Browser-rendered comparison is unavailable. The Product Design browser policy forbids substituting Playwright without the user's browser choice, and this task has no in-app Browser tool exposed.

## Implementation checks

- The status hero and payment confirmation are the primary region.
- The desktop stepper shows the full route horizontally; mobile switches the same steps to a full vertical timeline without clipping.
- The tracking payload allowlists storefront name, logo, and normalized theme; the page maps those values to the same color, font, and corner tokens used by the public store.
- Existing refresh, offline, realtime, availability, and product-summary behaviors remain.

## Required follow-up

1. Apply `20260726200000_ecom_order_tracking_storefront_branding.sql`.
2. Run the focused tests and storefront build in a terminal with process output available.
3. Capture desktop and mobile tracking states in an approved browser, compare them against the source, then replace this result with `passed` if no P0/P1/P2 issues remain.

final result: blocked
- Image quality and assets: real cover/logo assets are preserved. Products without source images use the existing Lanzo fallback rather than fabricated product imagery.
- Copy and content: business identity, availability, address, delivery, categories, product data, and actions remain. Promotional footer copy is deliberately shortened.

## Findings

- No actionable P0, P1, or P2 differences remain.
- P3: The generated concept contains sample product photography while the live catalog lacks images for several real products. This is a data constraint, not a layout defect.
- P3: The alternate local origin used for the focused footer capture rendered the catalog error state, but the footer itself rendered correctly in both responsive sizes. The primary catalog screenshots were captured from the working local store state.

## Comparison history

1. Initial catalog pass
   - P2: product card footer content was compressed horizontally.
   - Fix: explicitly restored flex layout and full-width actions in grid cards.
   - Evidence: `public-store-redesign-grid-target-843x1844.png`.
2. Interaction pass
   - Verified grid as the configured initial state and list as a working visitor-selected state.
   - Evidence: `public-store-redesign-grid-mobile.png` and `public-store-redesign-list-mobile.png`.
3. Footer pass
   - P1: the promotional footer competed with the catalog on mobile and desktop.
   - Fix: replaced the promotional block and dominant button with a compact attribution strip and text link.
   - Post-fix evidence: `public-store-footer-before-after.png`, `public-store-footer-mobile.png`, and `public-store-footer-desktop.png`.

## Verification

- Browser-rendered screenshots captured at mobile and desktop sizes.
- Primary interactions tested: grid/list toggle and responsive reflow.
- Browser console checked after the footer pass: no warnings or errors.
- ESLint passed.
- Production build passed.
- Ecommerce site renderer: 6 tests passed.
- React Doctor: 86/100, no errors; remaining warnings are existing broader maintainability/performance recommendations outside this visual change.

## Cart control visibility follow-up

- Root cause: a global button rule added `20px` of inline padding to fixed-width icon buttons, reducing the rendered SVG width to `2–3.69px`.
- Fix: cart icon buttons and quantity stepper buttons now explicitly use zero padding.
- Post-fix measurements: close `22×22px`, delete `18×18px`, decrease/increase `16×16px`.
- Visual evidence: `C:\dev\Lanzo-POS-Git\artifacts\public-cart-controls-fixed.png`.
- Interaction evidence: increase changed quantity `1→2`, decrease changed `2→1`, close dismissed the dialog, and delete removed the line and returned the cart to its empty state.

## Store business type follow-up

- The configured business type now appears beside `Tienda online` as a compact, theme-aware label.
- Public data uses the normalized `business_types_snapshot`, with the legacy portal value as fallback.
- Real portal evidence: `farmaciagary` resolves to `Abarrotes / Tienda`.
- Desktop evidence: `C:\dev\Lanzo-POS-Git\artifacts\public-store-business-type-header.png`.
- Mobile evidence: `C:\dev\Lanzo-POS-Git\artifacts\public-store-business-type-header-mobile.png`.
- Mobile viewport `390×844`: no horizontal overflow; both labels remain on one flexible row.

final result: passed

---

# Public order tracking redesign (option 1)

- Source visual truth: `C:\Users\pituf\.codex\generated_images\019fa0a7-b19d-7403-a0c1-e253f6214019\exec-9ff79c17-2db3-4342-a668-b046f08f7f40.png`
- Implementation capture: blocked; no user-selected or in-app Browser is available in this task.
- Intended viewports: desktop 1440 × 1024 and mobile below 672px.

**Findings**

- [P1] Browser-rendered comparison cannot be completed under the current Browser policy. The implementation needs a desktop and a mobile screenshot at the selected state before visual QA can pass.

**Implementation Checklist**

1. Apply `20260726200000_ecom_order_tracking_storefront_branding.sql`.
2. Run the focused tracking tests and `npm run build:store` in a terminal with process output available.
3. Capture and compare the approved browser states against the selected visual.

The implementation maps safe storefront name, logo, color, font, and radius values to the tracking page; its desktop stepper becomes a complete vertical timeline on mobile.

final result: blocked
