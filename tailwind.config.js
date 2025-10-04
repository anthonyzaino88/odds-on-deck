/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './app/**/*.{js,jsx}',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-blue': '#1e40af',
        'brand-green': '#059669',
        'brand-red': '#dc2626',
      },
    },
  },
  plugins: [],
}

