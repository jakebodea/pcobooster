/**
 * Public marketing pages, their prerendered assets, and the deployed version, never product
 * APIs.
 */
export const isPublicPath = (pathname: string): boolean =>
  pathname === "/" ||
  pathname === "/about" ||
  pathname === "/about/" ||
  pathname === "/robots.txt" ||
  pathname === "/sitemap.xml" ||
  pathname === "/version" ||
  pathname.startsWith("/marketing/");
