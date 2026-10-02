import OpenReplay from '@openreplay/tracker'

// Each app must list 'OPENREPLAY_' in envPrefix (vite.config.ts) or the key reads as undefined.
const tracker = new OpenReplay({
  projectKey: import.meta.env.OPENREPLAY_PROJECT_KEY,
})

export default tracker
