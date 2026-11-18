import type { NextConfig } from "next";

const apiPort = process.env.API_PORT ?? "4811";

const nextConfig: NextConfig = {
  // La preview apre l'app da 127.0.0.1: senza questo Next in dev blocca gli asset /_next/* (403) e React non si idrata.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: { authInterrupts: true },
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `http://127.0.0.1:${apiPort}/api/v1/:path*` }];
  },
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
