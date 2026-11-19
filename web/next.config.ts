import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 서버가 실행 중에 읽는 매물 파일을 배포 묶음에 포함 (lib/engine.ts)
  outputFileTracingIncludes: {
    "/**": ["./data/listings.json"],
  },
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
