import { onMounted, onUnmounted } from 'vue'

// Not in Figma: nothing tells the browser that a balance moved, so a page that shows one asks again
// while it is in view: every 15 seconds, and at once when its tab comes back into view.
export function useReread(reread: () => void, everyMs = 15_000) {
  const ask = () => { if (!document.hidden) reread() }

  let timer: ReturnType<typeof setInterval>
  onMounted(() => {
    timer = setInterval(ask, everyMs)
    document.addEventListener('visibilitychange', ask)
  })
  onUnmounted(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', ask)
  })
}
