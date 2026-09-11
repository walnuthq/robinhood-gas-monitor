import type { NextConfig } from "next"

/**
 * GitHub Pages serves a project site from `https://<owner>.github.io/<repo>`, so
 * every asset and link needs that prefix. The workflow passes it in rather than
 * hardcoding a repo name here, and leaves it empty for a user/org site
 * (`<owner>.github.io`) or a custom domain, where the site is at the root.
 */
const basePath = process.env.PAGES_BASE_PATH ?? ""

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],

  // Static export: every route is rendered at build time, so the gas database
  // is a build input and the deployed site needs no server at all.
  output: "export",
  basePath,
  // Emit `route/index.html` rather than `route.html`, which is what Pages
  // expects when serving a directory URL.
  trailingSlash: true,
  images: {
    // No image optimizer exists on Pages; nothing here uses next/image today,
    // but this keeps the build honest if something does later.
    unoptimized: true,
  },
}

export default nextConfig
