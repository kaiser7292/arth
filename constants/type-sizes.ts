/**
 * The type scale as plain numbers, for the few places that need a size in a style object (a
 * TextInput's style, an animated label) instead of a `text-label` … `text-hero` class.
 * Same steps as TYPE in constants/design-tokens.js.
 */
export const FONT_SIZE = { label: 12, meta: 13, body: 15, heading: 17, title: 22, display: 28, hero: 36 } as const;
