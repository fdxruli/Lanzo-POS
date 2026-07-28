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

---

# Modal de pedido — opción 3

- Source visual truth path: `C:\Users\pituf\.codex\generated_images\019fa748-24b9-7a91-be1a-b46501bfbfe9\call_ptKvVUEitDy4Ufg7GovefL9h.png`
- Implementation route: `/pedidos-online`, modal de un pedido aceptado.
- Implementation screenshot path: unavailable; the in-app browser did not attach and the authenticated Chrome tab lost control while reloading.
- Intended viewports: desktop 1440 × 900 CSS px and mobile 390 × 844 CSS px, device scale factor 1.
- State: light theme; accepted pickup order; operation panel visible; customer, items/total and history collapsed on mobile.
- Density normalization: not applicable until the browser-rendered captures are available.

**Full-view comparison evidence**

- Blocked. The selected reference was opened and inspected, but a browser-rendered implementation capture could not be obtained in the same state. No fidelity claim is made from code inspection alone.

**Focused region comparison evidence**

- Blocked. The operation panel, sticky action bar, desktop three-column workspace, mobile accordions and history expansion still require same-state captures.

**Findings**

- [P1] Visual comparison is unavailable.
  Location: order detail modal at `/pedidos-online`.
  Evidence: the approved source exists, but there is no valid implementation screenshot.
  Impact: layout overflow, hierarchy, sticky controls and responsive proportions cannot be accepted visually.
  Fix: capture the accepted-order modal at both intended viewports, combine each capture with the selected source in one comparison input, and fix any P0/P1/P2 differences.

**Open Questions**

- None in the implementation scope. The blocker is browser capture only.

**Implementation Checklist**

1. Capture the desktop accepted-order state at 1440 × 900.
2. Capture the mobile accepted-order state at 390 × 844 with secondary sections collapsed.
3. Test expanding “Cliente”, “Artículos y total” and “Historial”.
4. Compare source and implementation together and resolve visible P0/P1/P2 differences.

**Comparison history**

- Initial implementation pass: mobile-first disclosure panels, operation-first ordering, combined items/total presentation, bounded internal lists, desktop three-column layout and persistent bottom actions were implemented.
- Post-fix automated evidence: 18 focused tests passed, focused ESLint passed, the production build passed, and React Doctor scored 97/100 with only the two pre-existing custom-modal warnings.
- Post-fix visual evidence: unavailable; no visual QA iteration can be counted.

final result: blocked

---

# Pedidos en línea — adaptación mobile first

- Source visual truth: desktop option 3 at `C:\Users\pituf\.codex\generated_images\019fa748-24b9-7a91-be1a-b46501bfbfe9\call_7BRHVP0NFPbtwggbysbAs83O.png`.
- Intended implementation viewport: 390 × 844 CSS px at device scale factor 1.
- Implementation screenshot: unavailable. The authenticated Chrome tab and the in-app browser both remained in the administrative bootstrap after reload.
- State: light theme, `/pedidos-online`, authenticated order inbox with representative order volume.

## Full-view comparison evidence

Blocked. The desktop source remains the approved visual language, but there is no valid browser-rendered mobile implementation capture to evaluate composition, sticky controls, card density, or safe-area spacing.

## Focused comparison evidence

Blocked. The mobile tab strip, six-order progressive disclosure, search/filter controls, and expanded/collapsed states could not be captured in the authenticated app.

## Findings

- [P1] Mobile browser-rendered comparison is unavailable.
  - Location: `/pedidos-online` at 390 × 844.
  - Evidence: both available browser surfaces stopped at “Preparando Lanzo POS...” after loading the updated route.
  - Impact: sticky positioning, real-data wrapping, horizontal tab scrolling, and the expanded list state cannot be visually accepted.
  - Fix: capture the authenticated route after bootstrap completes, test the three mobile tabs and “Mostrar más”, then compare the same states.

## Automated interaction evidence

- 22 focused tests pass, including mobile group navigation and six-order progressive disclosure.
- Focused ESLint passes.
- Production build completes its main application bundle; existing PWA and dynamic-import warnings remain unrelated to this screen.

## Comparison history

- Initial mobile-first pass: implementation completed; visual QA blocked before a valid authenticated mobile capture.

final result: blocked

---

# Pedidos en línea — rediseño opción 3

- Source visual truth path: `C:\Users\pituf\.codex\generated_images\019fa748-24b9-7a91-be1a-b46501bfbfe9\call_7BRHVP0NFPbtwggbysbAs83O.png`
- Original product reference: `C:\Users\pituf\AppData\Local\Temp\codex-clipboard-4c913d7f-2661-4d03-960f-ca135f3bbf6e.png`
- Implementation screenshot path: unavailable; the in-app Browser remained in the administrative bootstrap without an active license and the authenticated Chrome connection was unavailable.
- Intended comparison viewport: 1440 × 850 CSS px at device scale factor 1.
- Source pixels: 1631 × 964.
- Original reference pixels: 1098 × 648.
- Implementation pixels: unavailable.
- State: light theme, `/pedidos-online`, real authenticated order data.

## Full-view comparison evidence

Blocked. The selected source visual and original product screenshot were opened and inspected, but the rendered implementation could not be captured in the same authenticated state. No fidelity claim is made from code or automated tests alone.

## Focused comparison evidence

Not performed because the full browser-rendered comparison is unavailable. Typography, filter controls, grouped columns, order cards, semantic colors, responsive stacking, and empty states still require visual inspection in the authenticated app.

## Findings

- [P1] Browser-rendered comparison is unavailable.
  - Location: `/pedidos-online`.
  - Evidence: the in-app Browser remained on “Preparando Lanzo POS...” and did not inherit the active license; the Chrome session that produced the original screenshot could not be connected.
  - Impact: spacing, column density, real-data wrapping, dark-theme rendering, and the 960 px responsive breakpoint cannot be accepted visually.
  - Fix: refresh the authenticated Pedidos en línea screen and capture the updated desktop view for comparison.

## Required fidelity surfaces

- Fonts and typography: implementation reuses the global Inter/Segoe UI stack and existing type tokens; visual weight and wrapping remain unverified.
- Spacing and layout rhythm: the three-column composition, 12 px gutters, 16 px group headers, and compact cards follow the selected direction; browser evidence is missing.
- Colors and visual tokens: all new surfaces and semantic states use Lanzo UI variables and `color-mix`; light and dark rendering remain visually unverified.
- Image quality and asset fidelity: no raster assets are required; icons come from the existing Lucide dependency used by the product.
- Copy and content: the redundant eyebrow is removed, the title is “Pedidos en línea”, and existing order fields/actions are preserved.

## Primary interactions checked

- Focused automated tests passed for opening orders, changing the real server-side status filter, local code/customer search, accepting, rejecting, preparing in POS, releasing claims, and clearing deep links.
- Browser console inspection reached only the bootstrap state and showed no implementation-specific error.

## Comparison history

- Initial pass: blocked before a valid implementation capture. No P0/P1/P2 visual fixes can be confirmed without authenticated browser evidence.

## Implementation checklist

1. Refresh the authenticated Pedidos en línea screen.
2. Capture the 1440 × 850 light-theme state with representative orders.
3. Compare it with the selected source, fix any P0/P1/P2 drift, and repeat until passed.

final result: blocked

## Security and regression correction — PR #136

- Initial HEAD: `2989528fae9e746a01bd6f1de8452666c3505263`.
- Root cause: the original branding migration was based on a pre-`ECOM.ORDERS.2.2` RPC and regressed its client, portal, and valid-token buckets, paused-portal resolver, uniform response flow, and `service_role` grant.
- Corrected source of truth: deployed `public.ecommerce_get_order_tracking(text,text)` plus `20260713023529_ecom_orders_2_2_tracking_client_rate_limit.sql`.
- Branding is now an allowlisted additive object; historical themes are normalized to four safe keys and defaults.
- Terminal states use specific copy and semantic icons; cancelled, rejected, and attention states do not render the normal progress timeline.
- Automated checks cover paused portals, legacy payloads, safe image fallback, CSS theme normalization, RPC privileges, rate-limit isolation, and rollback-only SQL fixtures.
- Visual status: pending. No desktop or mobile browser capture is claimed until the required states are rendered at 1440 × 1024 and 390 × 844.

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

---

# Latest QA status — Pedidos en línea, opción 3

- Automated verification: ESLint passed; production build passed; 20 focused tests passed; React Doctor scored 97/100.
- Visual source: `C:\Users\pituf\.codex\generated_images\019fa748-24b9-7a91-be1a-b46501bfbfe9\call_7BRHVP0NFPbtwggbysbAs83O.png`.
- [P1] The authenticated implementation could not be captured: the in-app browser remained in the license bootstrap and the active Chrome session was unavailable.
- Required next step: capture the refreshed authenticated `/pedidos-online` page at 1440 × 850, compare against the visual source, and resolve any P0/P1/P2 differences.

final result: blocked

---

# Latest QA status — Pedidos en línea mobile first

- Source visual truth: desktop option 3 at `C:\Users\pituf\.codex\generated_images\019fa748-24b9-7a91-be1a-b46501bfbfe9\call_7BRHVP0NFPbtwggbysbAs83O.png`.
- Intended implementation capture: `/pedidos-online`, light theme, 390 × 844 CSS px, device scale factor 1.
- Implementation screenshot: unavailable. Both the authenticated Chrome tab and the in-app browser remained at “Preparando Lanzo POS...” after reload.
- Full-view and focused comparisons: blocked; sticky controls, horizontal group navigation, six-order progressive disclosure, real-data wrapping, and safe-area spacing still require browser-rendered evidence.
- [P1] Capture the authenticated mobile route, test all three group controls plus “Mostrar más”, and compare those states against the approved system language before visual acceptance.
- Automated verification: 22 focused tests passed; focused ESLint passed; production build passed; React Doctor scored 97/100 with only the two pre-existing custom-modal warnings.

final result: blocked

---

# Modal de pedido — opción 3

- Source visual truth path: `C:\Users\pituf\.codex\generated_images\019fa748-24b9-7a91-be1a-b46501bfbfe9\call_ptKvVUEitDy4Ufg7GovefL9h.png`
- Implementation route: `/pedidos-online`, modal de un pedido aceptado.
- Implementation screenshot path: unavailable; the in-app browser did not attach and the authenticated Chrome tab lost control while reloading.
- Intended viewports: desktop 1440 × 900 CSS px and mobile 390 × 844 CSS px, device scale factor 1.
- State: light theme; accepted pickup order; operation panel visible; customer, items/total and history collapsed on mobile.
- Density normalization: not applicable until the browser-rendered captures are available.

**Full-view comparison evidence**

- Blocked. The selected reference was opened and inspected, but a browser-rendered implementation capture could not be obtained in the same state. No fidelity claim is made from code inspection alone.

**Focused region comparison evidence**

- Blocked. The operation panel, sticky action bar, desktop three-column workspace, mobile accordions and history expansion still require same-state captures.

**Findings**

- [P1] Visual comparison is unavailable.
  Location: order detail modal at `/pedidos-online`.
  Evidence: the approved source exists, but there is no valid implementation screenshot.
  Impact: layout overflow, hierarchy, sticky controls and responsive proportions cannot be accepted visually.
  Fix: capture the accepted-order modal at both intended viewports, combine each capture with the selected source in one comparison input, and fix any P0/P1/P2 differences.

**Open Questions**

- None in the implementation scope. The blocker is browser capture only.

**Implementation Checklist**

1. Capture the desktop accepted-order state at 1440 × 900.
2. Capture the mobile accepted-order state at 390 × 844 with secondary sections collapsed.
3. Test expanding “Cliente”, “Artículos y total” and “Historial”.
4. Compare source and implementation together and resolve visible P0/P1/P2 differences.

**Comparison history**

- Initial implementation pass: mobile-first disclosure panels, operation-first ordering, combined items/total presentation, bounded internal lists, desktop three-column layout and persistent bottom actions were implemented.
- Post-fix automated evidence: 18 focused tests passed, focused ESLint passed, the production build passed, and React Doctor scored 97/100 with only the two pre-existing custom-modal warnings.
- Post-fix visual evidence: unavailable; no visual QA iteration can be counted.

final result: blocked
