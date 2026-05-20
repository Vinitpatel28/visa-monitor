import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // If NEXT_PUBLIC_API_HOST is provided by Render, use it (with https://)
    // Otherwise fallback to localhost for local development
    const apiHost = process.env.NEXT_PUBLIC_API_HOST 
      ? `https://${process.env.NEXT_PUBLIC_API_HOST}` 
      : "http://localhost:3000";

    return [
      {
        source: "/api/:path*",
        destination: `${apiHost}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
