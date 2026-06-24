/** @type {import('next').NextConfig} */
const nextConfig = {
  // Folder-based routing places pages at /v2/cutting; assets must also live under /v2
  // so the single Worker Route (www.xpandaops.com/v2/*) covers both pages and chunks.
  // Do NOT also set basePath — that would double-prefix to /v2/v2/_next.
  assetPrefix: "/v2",
};

export default nextConfig;
