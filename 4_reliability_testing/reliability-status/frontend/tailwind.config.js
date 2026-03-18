/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        fog: "#e2e8f0",
        sky: "#0ea5e9",
        ember: "#f97316",
        moss: "#22c55e"
      }
    }
  },
  plugins: []
};
