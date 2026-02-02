/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#039be5',
          dark: '#0277bd',
        },
        accent: {
          DEFAULT: '#fbc02e',
          dark: '#f9a825',
        },
      },
    },
  },
  plugins: [],
};
