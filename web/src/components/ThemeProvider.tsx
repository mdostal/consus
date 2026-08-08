import React, { createContext, useContext, useState, useEffect } from "react";
import "../themes/spacious.css";

export type Theme = "balanced" | "spacious";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("balanced");

  useEffect(() => {
    if (theme === "spacious") {
      document.body.classList.add("theme-spacious");
    } else {
      document.body.classList.remove("theme-spacious");
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switcher" style={{ marginBottom: "1rem" }}>
      <label htmlFor="theme-select" style={{ marginRight: "0.5rem" }}>
        Theme:
      </label>
      <select
        id="theme-select"
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        <option value="balanced">Balanced</option>
        <option value="spacious">Spacious</option>
      </select>
    </div>
  );
}
