import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the wordmark in the corner, and it
  // would appear in any screen recording made from the dev server.
  devIndicators: false,
};

export default nextConfig;
