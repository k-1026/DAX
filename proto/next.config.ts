import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // 관리자 "다음에 할 일 제안" 규칙 파일(md)을 서버에 같이 올린다.
  outputFileTracingIncludes: { "/admin/**": ["./content/admin-playbook/**"] },
  partialPrefetching: true,
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
