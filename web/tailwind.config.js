/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // xs breakpoint: room-check threshold below the toolbar collapses.
    // Above the built-in sm (640px), everything is desktop-styled.
    screens: {
      xs: "480px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        // Bridge to the CSS custom properties in index.css so theme switch
        // is a single `data-theme` attribute flip on <html>. The `panel-*`
        // classes keep working across every component.
        panel: {
          bg: "rgb(var(--panel-bg) / var(--panel-bg-alpha))",
          border: "rgb(var(--panel-border) / var(--panel-border-alpha))",
          fg: "rgb(var(--panel-fg))",
          muted: "rgb(var(--panel-muted))",
        },
      },
    },
  },
  plugins: [],
};
