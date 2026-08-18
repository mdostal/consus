import { useThemePreference, type ThemePreference } from "./useThemePreference";
import { useSkinPreference, type SkinPreference } from "./useSkinPreference";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SKIN_OPTIONS: { value: SkinPreference; label: string }[] = [
  { value: "drafting", label: "Drafting Table" },
  { value: "case-board", label: "Case Board" },
  { value: "harness", label: "Harness" },
];

/**
 * The app shell's manual theme (light/dark/system) and skin (Drafting
 * Table/Case Board/Harness) controls (s1, consus-phase18) — two plain
 * <select>s wired straight to the two independent preference hooks. Not
 * required to be visually elaborate in this story (later polish is s5's
 * scope); it just needs to be real and present in the app shell.
 */
export function ThemeSkinPicker() {
  const { preference: theme, setPreference: setTheme } = useThemePreference();
  const { skin, setSkin } = useSkinPreference();

  return (
    <div className="theme-skin-picker">
      <label className="theme-skin-picker__control">
        Theme
        <select
          aria-label="Theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemePreference)}
        >
          {THEME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="theme-skin-picker__control">
        Skin
        <select
          aria-label="Skin"
          value={skin}
          onChange={(e) => setSkin(e.target.value as SkinPreference)}
        >
          {SKIN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
