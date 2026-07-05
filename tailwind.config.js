/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter_400Regular", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        button: "14px",
      },
      fontSize: {
        display: ["32px", { lineHeight: "38px" }],
        title: ["24px", { lineHeight: "32px" }],
        headline: ["18px", { lineHeight: "26px" }],
        body: ["16px", { lineHeight: "24px" }],
        caption: ["14px", { lineHeight: "20px" }],
        label: ["12px", { lineHeight: "16px" }],
        micro: ["10px", { lineHeight: "14px" }],
      },
      colors: {
        surface: {
          light: "#FFFFFF",
          "light-alt": "#F7F7F5",
          dark: "#111111",
          "dark-alt": "#1E1E1E",
        },
        border: {
          light: "#E5E5E3",
          dark: "#2E2E2E",
        },
        text: {
          primary: "#1A1A1A",
          secondary: "#6B7280",
          tertiary: "#9CA3AF",
          "dark-primary": "#FFFFFF",
          "dark-secondary": "#A0A0A0",
          "dark-tertiary": "#6B7280",
        },
        success: "#22C55E",
        danger: "#EF4444",
        warning: "#F59E0B",
        budget: {
          under: "#22C55E",
          warning: "#F59E0B",
          over: "#EF4444",
        },
      },
    },
  },
  plugins: [],
};
