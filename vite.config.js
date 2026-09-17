import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// BASE_PATH is "/<repo>/" on GitHub project pages; VITE_GITHUB_REPOSITORY lets the
// static site start the refresh workflow. Both are set by .github/workflows/pages.yml.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react(), tailwindcss()],
  cacheDir: ".cache/vite",
  server: { host: "127.0.0.1" },
});
