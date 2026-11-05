import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  outputFileTracingRoot: path.join(process.cwd()),
  // Shared Server Actions can reach the lazily loaded auth client on any page.
  // Include its native runtime in each route's serverless deployment trace.
  outputFileTracingIncludes: {
    "/**": ["./generated/prisma/**/*"]
  }
};

export default nextConfig;
