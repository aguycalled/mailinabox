/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcd9ff",
          300: "#8ec1ff",
          400: "#599dff",
          500: "#3577f6",
          600: "#1f57db",
          700: "#1a44b1",
          800: "#1b3c8c",
          900: "#1c376f",
        },
      },
    },
  },
  plugins: [],
};
