// Tailwind 4 processing is handled by the @tailwindcss/vite plugin in
// vite.config.ts. PostCSS is retained only for autoprefixer.
export default {
  plugins: {
    autoprefixer: {},
  },
}
