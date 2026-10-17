// The theme the user chose: dark, unless <html> carries data-theme="light" (the values are in
// assets/light.css). The browser keeps the choice, and index.html applies it before the first paint.
import { ref } from 'vue'

export type Theme = 'dark' | 'light'

const KEY = 'noda.theme'
const root = document.documentElement
const theme = ref<Theme>(root.dataset.theme === 'light' ? 'light' : 'dark')

function setTheme(next: Theme) {
  theme.value = next
  if (next === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
  // A browser that refuses to store it still shows the choice until the page is closed.
  try { localStorage.setItem(KEY, next) } catch { /* storage is blocked */ }
}

export function useTheme() {
  return { theme, toggle: () => setTheme(theme.value === 'dark' ? 'light' : 'dark') }
}
