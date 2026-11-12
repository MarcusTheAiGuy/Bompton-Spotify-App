import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        spotify: {
          black: "#191414",
          base: "#121212",
          elevated: "#181818",
          highlight: "#1f1f1f",
          border: "#2a2a2a",
          green: "#1DB954",
          "green-hover": "#1ed760",
          text: "#ffffff",
          subtext: "#b3b3b3",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 8px 24px rgba(0,0,0,0.5)",
      },
      // The Wrapped guess story: each slide's progress bar fills over
      // seven seconds, then the slide advances.
      keyframes: {
        "wrapped-fill": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        "wrapped-rise": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "wrapped-fill": "wrapped-fill 7s linear forwards",
        "wrapped-rise": "wrapped-rise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
