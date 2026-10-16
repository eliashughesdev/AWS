// An icon colour with the darker disc it sits on.
export const tones = {
  green:  'bg-green-dim text-green',
  blue:   'bg-blue-dim text-blue',
  teal:   'bg-accent-dim text-accent',
  yellow: 'bg-yellow-dim text-yellow',
}

export type Tone = keyof typeof tones

// A status pill: a hairline, a dim fill and coloured text; in light a solid fill and white text.
// "Failed" is not from the design.
export const pills = {
  Completed: 'border-accent bg-accent-dim text-accent light:bg-accent light:text-white',
  Pending:   'border-yellow bg-yellow-dim text-yellow light:border-pending light:bg-pending light:text-white',
  Failed:    'border-red bg-red-dim text-red light:bg-red light:text-white',
  // Not from the design: an API key's status.
  Active:    'border-accent bg-accent-dim text-accent light:bg-accent light:text-white',
  Expired:   'border-yellow bg-yellow-dim text-yellow light:border-pending light:bg-pending light:text-white',
  Revoked:   'border-faint text-muted light:bg-faint light:text-white',
}

export type PillStatus = keyof typeof pills

// The colour of a summary card's dot.
export const dots = {
  teal:   'text-accent [--glow:var(--color-accent-bright)]',
  yellow: 'text-yellow',
  green:  'text-green',
  orange: 'text-orange',
  red:    'text-red',
}

export type Dot = keyof typeof dots
