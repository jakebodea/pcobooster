import { describe, expect, it } from "vitest";

import { isPublicPath } from "./public-paths";

describe("public marketing routes", () => {
  it.each([
    "/",
    "/about",
    "/about/",
    "/robots.txt",
    "/sitemap.xml",
    "/version",
    "/marketing/assets/index.js",
    "/marketing/screenshots/assign.webp",
  ])("allows %s without a session", (pathname) => {
    expect(isPublicPath(pathname)).toBeTruthy();
  });

  it.each([
    "/services",
    "/people",
    "/api/rpc/people/positionCandidates",
    "/api/auth/get-session",
    "/about-team",
    "/marketing-private",
    "/marketing",
    "/versions",
  ])("does not exempt %s from product authentication", (pathname) => {
    expect(isPublicPath(pathname)).toBeFalsy();
  });
});
