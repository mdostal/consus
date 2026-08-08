import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import "../themes/compact.css";

type ThemeMode = "balanced" | "compact";

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("balanced");

  useEffect(() => {
    if (theme === "compact") {
      document.body.classList.add("theme-compact");
    } else {
      document.body.classList.remove("theme-compact");
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className="theme-switcher" style={{ padding: "1rem", background: "var(--consus-bg-subtle)", display: "flex", gap: "1rem" }}>
        <label>
          <input
            type="radio"
            name="theme"
            value="balanced"
            checked={theme === "balanced"}
            onChange={() => setTheme("balanced")}
          />
          Balanced
        </label>
        <label>
          <input
            type="radio"
            name="theme"
            value="compact"
            checked={theme === "compact"}
            onChange={() => setTheme("compact")}
          />
          Compact
        </label>
      </div>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
