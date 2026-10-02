import OpenReplay from '@openreplay/tracker'

const tracker = new OpenReplay({
  projectKey: import.meta.env.OPENREPLAY_PROJECT_KEY,
})

export default tracker
