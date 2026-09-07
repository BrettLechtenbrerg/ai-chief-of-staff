# Orbital Command

Local-only design checkpoint, 2026-09-05. Source changes are not yet installed.

## Design read

Application UI leads; reports and Budget & Books are data-dense supporting views.
Brett works here repeatedly, across chat, connected tools and local creative drafts.
The job is to see the current task, inspect evidence, then take one clear action.
External actions and financial corrections have higher consequences than drafting.
Keep existing navigation names, keyboard routes, trusted IPC and approval surfaces.

The approved direction is deep ink/navy, silver text, cyan actions, restrained violet
creative accents, amber approval attention and red failures. No fake terminal,
starfield, persistent glow, new font service, canvas or renderer replacement.

## Evidence and thesis

Primary evidence: existing theme palettes, shared CSS, inline stroke SVG icons,
Hook Lab and Video Studio rendered fixtures. Structural references from the UI
skill are Linear's stable work navigation and Superhuman's action hierarchy, with
Intercom as the contrast against oversized conversation chrome. These are direction
references, not inspected current product screenshots or copied product designs.

First glance: task title/status and primary action. Second: source/date/coverage,
selected context and editable evidence. Borders separate instruments; surface steps
separate navigation, work and details. Borders are not decorative glow layers.
Use one content rail within each existing panel and preserve its surrounding shell.

The orbital motif belongs because the user requested space-age character and the
video workflow has real ordered review stages. A small connected ordered list names
Plan, Preview and Local render; it does not pretend that work is running or complete.
Remove decorative shadows from the new skin instead of adding another ornament.

## Reuse map and tokens

- `src/settings/themes.ts`: add `orbital-command`; retain all previous themes/defaults.
- Existing `theme-loader.js` applies palettes and stamps `data-skin`; no parallel loader.
- `tokens.css` / `variables.css`: shared font, radius, motion and semantic color roles.
- `ui/shared/ui.css`: existing shared utility layer (there is no `utilities.css`).
- Existing panel classes, sidebar, messages, approval buttons and focus management.
- Bundled Helveticaneue body and existing bold face for compact headers. Genty display
  is not the new instrument face. No external fonts or additional icon family.

Palette: ink `#08111f`, chrome `#101e32`, raised `#192b42`, silver `#edf4ff`,
secondary `#c6d3e3`, muted `#a1b3c9`, control border `#6a809b`, cyan `#5cdeff`,
creative violet `#baabff`, warning `#ffd184`, error `#ff939b`, success `#75dfb1`.
Money, dates and metadata use tabular numerals. Keep reading text proportional.

New-skin controls use compact consistent radii, visible keyboard-only focus and
named-property transitions. Native selects retain their platform chevron/inset.
No hover translation, ambient animation or pointer focus decoration. Reduced motion
removes transitions. Theme changes clear the skin-specific CSS by selector scoping.

## Budget & Books design read (step15)

Data-dense application workspace for one operator; the primary job is to review
records before treating them as usable budget evidence. Errors have financial
consequences, so source scope, exact amounts and confirmation beat decoration.
Local references are the existing Video Studio shell, Hook Lab forms, shared work
rail, native selects, sidebar stroke SVGs and amber approval surface; no new library.

First glance: entity/currency/year and local status. Second: actuals, unreviewed
counts and evidence. The primary action is local CSV review (account setup first
when empty). Overview, Transactions, Import and Plan keep stable order. Tables
stay inside a keyboard-scrollable region; forms reflow to one column. All text uses
existing bundled typography/tokens; no new card effects or ambient animation.

Map / Review / Import is a real ordered workflow, not a fake progress indicator.
Use native labels, buttons, details and fields; explicit keep/skip for duplicates;
readonly originals with editable allocations; separate draft and committed states.
Persist no financial input to browser localStorage. Preserve unsaved form values
in bounded, entity/currency-scoped session memory; closing import cancels its preview.
Errors retain inputs and offer retry; backup failures must distinguish saved data
from failed writes. Native local confirmations default to Cancel. AI uses existing
amber exact-argument approval, an anonymous aggregate, a pinned provider/model and
no prior chat history/tools. Raw finance paste/drop must never attach to hidden chat.

Rendered/keyboard/zoom/contrast/reduced-motion and assistive-technology evidence is
pending step16; these design decisions are not accessibility-conformance claims.

## Components and states

Preserve empty/loading/error/retry/disabled and long-text states. Text names status;
color is supplemental. Approval attention stays amber with exact argument/destination
review and distinct reject/approve controls. Never downgrade it to a muted toast.
Theme availability does not change a user's stored theme. Activation is only on
Brett's Mac, at the final backed-up installation checkpoint, not a beta default.

## Verification scope

Capture synthetic before/after chat, creative and approval surfaces at normal,
wide and narrow widths. Check theme switching, token contrast, keyboard focus,
long content and reduced motion. Keep rendered evidence separate from source reads.
The integrated Electron/VoiceOver, 200% zoom, all-panel/state matrix and focus-return
checks are step16, with regression/performance/install gates in steps17–18.
No accessibility, security or performance certification is implied by this document.

## Step11 source checkpoint evidence

**RUNTIME:** 18 before/after screenshots of real app markup/styles: chat, Video
Studio and approvals at 1280, 800 and 320 CSS pixels. The two narrow cases use the
existing collapsed sidebar state. Isolated Chrome retained its native sandbox;
page network requests were denied by interception and an inert proxy. No app
account data, providers or live approvals were used. The real approval renderer
restored composer focus after Escape; its native bridge was a synthetic fixture.

The first full-page fixture incorrectly forced `display:none` inline, overriding
Video Studio's class-based visibility. Its startup state also omitted `app-ready`.
The fixture now follows the real visibility contract and asserts nonzero bounds
and visible ancestors before accepting screenshots. No production visibility or
security control was removed to obtain a passing image.

**Measured:** 32 text/semantic-color pairs have minimum contrast 5.98:1 across
four surfaces; control borders have minimum 3.15:1; dark text on solid accent,
warning/error actions has minimum 8.92:1. These are token calculations, not an
all-rendered-elements accessibility audit. Contrast and actual theme-loader
switch/clear behavior have unit guards.

**Revision:** corrected narrow composer intrinsic widths and wrapping, restored
its keyboard outline, aligned creative headers/content to one rail, and removed
unnecessary cyan framing from configured cards. Replaced old video status glyphs
with plain status text; explicit hidden controls remain hidden. Approval frame,
capability and confirm action are amber. Reduced-motion controls computed 0s
transitions. Final Orbital fixtures have no detected horizontal overflow or
hidden ancestors. The unchanged TSAI baseline still overflows its composer at
320px; retain that as an integrated legacy-theme issue for step16.

### Rendered critique (judgment, not conformance): 20/24

| Criterion | Score | Evidence / limit |
| --- | --- | --- |
| Brief specificity | 2 | Local video planning and review stages are explicit. |
| Hierarchy | 2 | Neutral setup cards; cyan planning; amber approval. |
| Composition | 2 | Header, stage path and creative card edges share a rail. |
| Consistency / flow | 2 | Existing navigation, forms, icon set and approval flow retained. |
| Typography | 1 | Bundled faces remain legible; fallback/text-scaling checks pending. |
| Surface logic | 2 | Neutral containment, no glow or decorative elevation. |
| State completeness | 1 | Empty, ready, optional-missing, disabled and approval states checked; full matrix pending. |
| Responsive behavior | 2 | Observed 320/800/1280 layouts preserve controls and reading order. |
| Accessibility | 1 | Contrast, focus return and native controls checked; manual full-scope work remains. |
| Motion | 2 | Static workflow path, named transitions, reduced-motion check passed. |
| Authenticity | 2 | Fixtures explicitly synthetic; no invented live results. |
| Distinctiveness | 1 | Restrained instrument palette and orbital sequence; no ornamental scene. |

**Independent release gate remains UNVERIFIED:** Electron, VoiceOver, full keyboard
modal containment, 200% text/zoom, RTL/forced colors and all panels/states. A rubric
score does not waive step16. Theme source and targeted tests are ready for the next
implementation checkpoint; no live theme setting, app install or beta changed.
