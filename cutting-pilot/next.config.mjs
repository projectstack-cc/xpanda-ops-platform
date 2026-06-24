/** @type {import('next').NextConfig} */
const nextConfig = {
  // basePath scopes all pages, API routes, and asset URLs under /v2.
  // App files live at app/cutting (no v2/ folder) — basePath provides the prefix.
  // Do NOT also set assetPrefix — basePath already covers it; double-setting causes /v2/v2/_next.
  basePath: "/v2",
};

export default nextConfig;
