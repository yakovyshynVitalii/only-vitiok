export default defineNuxtConfig({
  compatibilityDate: "2025-10-01",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/eslint"],
  colorMode: {
    preference: "dark",
    fallback: "dark",
  },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    appRoot: process.cwd()
  },
  typescript: {
    strict: true,
    typeCheck: true
  }
});
