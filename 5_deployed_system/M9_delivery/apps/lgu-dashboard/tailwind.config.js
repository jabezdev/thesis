/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}" // Include shared UI
  ],
  theme: {
    extend: {
      colors: {
        background: "white",
        foreground: "black",
      }
    },
  },
  plugins: [],
}
