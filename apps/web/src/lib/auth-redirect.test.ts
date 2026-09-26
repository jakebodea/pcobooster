import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGN_IN_RETURN_PATH,
  describeSignInError,
  sanitizeReturnPath,
} from "./auth-redirect";

describe(sanitizeReturnPath, () => {
  it("keeps app-relative paths with query and hash", () => {
    expect(sanitizeReturnPath("/people/123?tab=history#notes")).toBe(
      "/people/123?tab=history#notes"
    );
  });

  it.each([
    null,
    "",
    "people",
    "https://evil.example/services",
    "//evil.example/services",
    "/\\evil.example",
    "/auth",
    "/auth?next=/services",
    "/api/rpc",
  ])("falls back to the default for %j", (value) => {
    expect(sanitizeReturnPath(value)).toBe(DEFAULT_SIGN_IN_RETURN_PATH);
  });
});

describe(describeSignInError, () => {
  it("returns null without an error code", () => {
    expect(describeSignInError(null)).toBeNull();
    expect(describeSignInError("")).toBeNull();
  });

  it("explains a declined Planning Center consent", () => {
    expect(describeSignInError("access_denied")).toBe(
      "Planning Center access wasn't granted. Try again when you're ready."
    );
  });

  it("explains an organization that could not be linked", () => {
    expect(describeSignInError("account_not_linked")).toBe(
      "We couldn't add this Planning Center organization to your account. Please try again."
    );
  });

  it("uses generic copy for unknown codes", () => {
    expect(describeSignInError("something_new")).toBe(
      "Something went wrong signing in with Planning Center. Please try again."
    );
  });
});
