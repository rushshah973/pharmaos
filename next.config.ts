import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Keep the dev badge off the sidebar's user row.
  devIndicators: { position: "bottom-right" },
  partialPrefetching: true,
  turbopack: {
    // The app is its own root (a package-lock.json higher up must not be picked as the workspace root).
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
