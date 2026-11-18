import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Tutta l'app e autenticata e dinamica (sessione nel layout): niente cacheComponents.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
