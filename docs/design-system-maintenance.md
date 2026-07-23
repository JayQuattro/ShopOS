# Design system maintenance

ShopOS owns the component source in `src/components/ui` and the domain compositions in
`src/components/shopos`. shadcn is the upstream starting point, not a runtime component dependency.

## Adding a component

1. Confirm an existing primitive or ShopOS composition cannot express the interaction clearly.
2. Review the current component documentation and source in the
   [shadcn registry](https://ui.shadcn.com/docs/components).
3. Add only the primitive and Radix dependency required by the validated workflow.
4. Preserve the ShopOS semantic token contract. Do not introduce provider, organization, page, or
   preset-specific colors inside a component.
5. Document accessible names, keyboard behavior, responsive behavior, loading, disabled, invalid, and
   destructive states as applicable.
6. Add focused behavioral tests. Avoid snapshots and assertions against entire utility-class strings.
7. Exercise the component with realistic fictional content in `/design-system`.
8. Run the complete local quality gate and production build.

## Reviewing an upstream update

Treat registry updates like a manual vendor-source review:

1. Record the current ShopOS component and the upstream component version or retrieval date.
2. Compare the upstream source with the repository source before applying changes.
3. Preserve intentional ShopOS adaptations, especially 44-pixel controls, focus treatment, semantic
   statuses, reduced motion, responsive behavior, and domain language.
4. Add new dependencies only when the changed behavior needs them.
5. Review changes for client-boundary growth, bundle impact, keyboard behavior, accessible naming,
   portal/focus handling, and theme-token compatibility.
6. Validate every supported preset and density. High-consequence actions require an explicit manual
   keyboard and screen-reader review.

Do not run a bulk registry overwrite across `src/components/ui`. Each copied update is an intentional
source change with its own reviewable diff.
