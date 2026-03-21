import { resolve } from "node:path";

export default defineNuxtConfig({
  compatibilityDate: "2025-10-01",
  devtools: { enabled: true },
  alias: process.env.NODE_ENV === "production"
    ? {}
    : {
        "#app-manifest": resolve(process.cwd(), ".nuxt/manifest/meta/dev.json"),
      },
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
