import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served as static files at /admin/ (see conf/nginx-primaryonly.conf
// and setup/web.sh). It uses hash routing so SPA routes live in the URL fragment
// (/admin/#/users) and never collide with the JSON API, which stays at /admin/*
// and is proxied to the daemon — preserving the public API contract.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
