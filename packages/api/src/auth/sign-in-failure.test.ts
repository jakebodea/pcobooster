import { describe, expect, it } from "vitest";

import { SignInFailure, parseSignInFailure } from "./sign-in-failure";

describe(parseSignInFailure, () => {
  it("reads a known code from a callback redirect", () => {
    const failure = parseSignInFailure(
      "http://localhost:3000/auth?next=%2Fservices&error=account_not_linked"
    );
    expect(failure).toBeInstanceOf(SignInFailure);
    expect(failure?._tag).toBe("SignInFailure");
    expect(failure?.code).toBe("account_not_linked");
    expect(failure?.receivedCode).toBe("account_not_linked");
    expect(failure?.description).toBeNull();
  });

  it("keeps an unrecognized code instead of dropping it", () => {
    const failure = parseSignInFailure(
      "/auth?error=brand_new_code&error_description=Something%20new"
    );
    expect(failure?.code).toBe("unknown");
    expect(failure?.receivedCode).toBe("brand_new_code");
    expect(failure?.description).toBe("Something new");
  });

  it("ignores redirects without an error", () => {
    expect(parseSignInFailure("http://localhost:3000/services")).toBeNull();
    expect(parseSignInFailure("/auth?error=")).toBeNull();
    expect(parseSignInFailure(null)).toBeNull();
  });
});
