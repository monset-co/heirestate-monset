// Light or dark, beside the bell. Kept on this device (localStorage "heir-theme"); splash.js puts it
// on <html data-theme> before the first paint, so a dark admin never flashes light. admin.css holds
// the dark colours.
import { Moon, Sun } from "lucide-react";
import { useState } from "react";

const KEY = "heir-theme";
const current = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export default function ThemeSwitch() {
  const [theme, setTheme] = useState(current);
  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    setTheme(next);
  }
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light" : "Switch to dark"}
      className="press grid size-10 place-items-center rounded-full text-cream/75 hover:bg-side-2 hover:text-cream"
    >
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
