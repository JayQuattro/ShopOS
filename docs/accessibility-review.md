# Accessibility review guide

ShopOS targets WCAG 2.2 AA conformance. Automated tests cover role/label structure,
keyboard interaction, focus visibility, reduced-motion, and non-color status cues in
jsdom. The following require periodic manual review and are part of feature acceptance.

## Required manual reviews

### Screen reader

- Test with NVDA (Windows) and VoiceOver (macOS/iOS).
- Verify every interactive element has an accessible name.
- Verify form labels are programmatically associated (`<label htmlFor>`).
- Verify dynamic content changes (toasts, loading states, permission errors) are
  announced via `aria-live` or `role="status"`/`role="alert"`.
- Verify the skip-to-main-content link is the first focusable element.

### Keyboard-only

- Complete every workflow using only Tab, Shift+Tab, Enter, Space, Escape, and arrow keys.
- Verify focus is visible at all times (3px `--ring` outline).
- Verify modal/dialog focus is trapped while open and restored to the trigger on close.
- Verify no keyboard traps outside of intentional modals.
- Verify dropdown menus open with Enter, navigate with arrows, close with Escape.

### Zoom and reflow

- Test at 200% zoom — content must reflow without horizontal scrolling.
- Test at 400% zoom — content must remain usable (single-column layout).
- Verify no content is clipped or hidden at any zoom level.

### Contrast

- Run an automated contrast audit (WAVE, axe DevTools) across all theme presets
  (Light, Dark, Warm, Dusk).
- The `theme.test.ts` contrast gate enforces WCAG AA on 19 critical token pairs per
  preset; manual review should cover component-level contrast not captured by the
  token gate (e.g. text on status-badge backgrounds, focus rings on colored surfaces).

### Touch targets

- Verify all interactive elements meet the 44×44px minimum touch target.
- The `--control-height` token (2.75rem default, 2.5rem compact) enforces this for
  buttons/inputs; manual review should cover icon-only buttons, links in dense tables,
  and mobile drawer navigation.

### Real-device testing

- Test on at least one iOS (Safari/VoiceOver) and one Android (Chrome/TalkBack) device.
- Verify the mobile navigation drawer, command palette, and org/location switcher are
  fully operable by touch + screen reader.

## Surfaces to review

| Surface                            | Key concerns                                                      |
| ---------------------------------- | ----------------------------------------------------------------- |
| `/sign-in`, `/sign-up`, auth forms | Label association, error announcement, password-visibility toggle |
| `/app/<org>/members`               | Table semantics, action buttons, invite dialog                    |
| `/platform/organizations/[id]`     | Entitlement management, status actions, audit history             |
| `/app/<org>` (dashboard)           | Summary cards, permission-gated content visibility                |
| Design-system catalog              | Representative coverage of all primitives                         |
| Command palette (⌘K)               | Focus trap, keyboard navigation, escape behavior                  |
| Mobile sidebar drawer              | Focus trap, touch target sizes, screen-reader landmarks           |
