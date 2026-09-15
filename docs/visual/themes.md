# Themes

Consus supports three **themes** that control light/dark mode:

| Theme | Description |
|-------|-------------|
| **Light** | Always light, regardless of OS setting |
| **Dark** | Always dark, regardless of OS setting |
| **System** | Follows the OS appearance setting (recommended) |

---

## Switching themes

**UI:** click the theme control in the masthead (sun/moon icon, or a theme toggle label).

**Command palette:** open `⌘K`, type `theme`, and choose light / dark / system.

The selected theme is stored in the browser and persists across sessions.

---

## Themes and skins

Theme controls the light/dark contrast; [skin](skins.md) controls the color palette and visual personality. They are independent — you can use any skin in any theme.

The four skins × three themes give twelve combinations. The Granary skin in system mode (the default for fresh installs) tracks your OS appearance automatically.

---

## Command palette

The `⌘K` command palette gives keyboard access to every UI action including skin and theme switching. Open it from anywhere in the app.

Common commands:

| Command | What it does |
|---------|-------------|
| `skin granary` | Switch to Granary skin |
| `skin drafting` | Switch to Drafting Table skin |
| `skin case` | Switch to Case Board skin |
| `skin harness` | Switch to Harness skin |
| `theme light` | Force light mode |
| `theme dark` | Force dark mode |
| `theme system` | Follow OS appearance |
| `ingest` | Trigger a doc scan for the current project |
| `scan all` | Scan all configured projects |
