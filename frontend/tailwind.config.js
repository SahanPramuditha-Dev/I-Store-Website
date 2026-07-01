/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        glass: 'rgba(255,255,255,0.08)'
      }
    }
  },
  darkMode: 'class',
  plugins: []
}
