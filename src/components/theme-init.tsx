"use client";

import { useEffect } from "react";

/** Applica la classe .dark in base alla preferenza del sistema (senza tag script nell'albero React). */
export function ThemeInit() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return null;
}
