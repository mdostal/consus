/**
 * Utility functions for accessibility (WCAG AA compliance)
 */

export const ariaHidden = (isHidden: boolean) => {
  return isHidden ? { "aria-hidden": true } : {};
};

export const ariaExpanded = (isExpanded: boolean) => {
  return { "aria-expanded": isExpanded };
};

export const srOnlyStyle = {
  position: "absolute" as const,
  width: "1px",
  height: "1px",
  padding: "0",
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap" as const,
  borderWidth: "0",
};

/**
 * Ensures focus stays within a specified element (for modals, dialogs)
 */
export const trapFocus = (element: HTMLElement, e: KeyboardEvent) => {
  const focusableEls = element.querySelectorAll(
    'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
  );
  
  if (focusableEls.length === 0) return;
  
  const firstFocusableEl = focusableEls[0] as HTMLElement;
  const lastFocusableEl = focusableEls[focusableEls.length - 1] as HTMLElement;
  
  const isTabPressed = e.key === "Tab" || e.keyCode === 9;
  
  if (!isTabPressed) {
    return;
  }
  
  if (e.shiftKey) {
    if (document.activeElement === firstFocusableEl) {
      lastFocusableEl.focus();
      e.preventDefault();
    }
  } else {
    if (document.activeElement === lastFocusableEl) {
      firstFocusableEl.focus();
      e.preventDefault();
    }
  }
};
