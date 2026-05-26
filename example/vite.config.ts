import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Serves the showcase from example/. The Convex functions live in
// example/convex and run on the linked dev deployment (VITE_CONVEX_URL).
export default defineConfig({
  plugins: [react()],
});
