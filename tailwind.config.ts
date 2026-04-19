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
    },
  },
  plugins: [],
};

export default config;
