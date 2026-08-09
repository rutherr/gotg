/** tailwind.config.js */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./public/**/*.html", "./public/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        team: {
          blue: "#1d4ed8",
          "blue-dark": "#1e3a8a",
          red: "#b91c1c",
          "red-dark": "#7f1d1d",
        },
      },
      fontFamily: {
        display: ["Rajdhani", "sans-serif"],
      },
    },
  },
  plugins: [],
};
