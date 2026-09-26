export const DEFAULT_SIGN_IN_RETURN_PATH = "/services";

/** Query parameter the proxy uses to remember where a signed-out visitor was headed. */
export const SIGN_IN_RETURN_PARAM = "next";

const ORIGIN_PLACEHOLDER = "http://return-path.invalid";

/**
 * Accepts only same-origin, app-relative paths so `?next=` cannot become an
 * open redirect. Anything else falls back to the default landing page.
 */
export const sanitizeReturnPath = (value: string | null): string => {
  if (value === null || !value.startsWith("/")) {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }
  if (value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }

  let url: URL;
  try {
    url = new URL(value, ORIGIN_PLACEHOLDER);
  } catch {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }
  if (url.origin !== ORIGIN_PLACEHOLDER) {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }
  if (url.pathname === "/auth" || url.pathname.startsWith("/api/")) {
    return DEFAULT_SIGN_IN_RETURN_PATH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

const EXPIRED_SIGN_IN_ERROR = "That sign-in link expired. Please start again.";

const SIGN_IN_ERROR_MESSAGES = new Map([
  [
    "access_denied",
    "Planning Center access wasn't granted. Try again when you're ready.",
  ],
  ["state_mismatch", EXPIRED_SIGN_IN_ERROR],
  ["state_not_found", EXPIRED_SIGN_IN_ERROR],
  ["please_restart_the_process", EXPIRED_SIGN_IN_ERROR],
  [
    "unable_to_get_user_info",
    "We couldn't read your Planning Center profile. Please try again.",
  ],
  [
    "account_not_linked",
    "We couldn't add this Planning Center organization to your account. Please try again.",
  ],
  [
    "account_already_linked_to_different_user",
    "This Planning Center login is already connected to a different PCOBooster account.",
  ],
  [
    "email_not_found",
    "Your Planning Center profile needs an email address to sign in.",
  ],
]);

const GENERIC_SIGN_IN_ERROR =
  "Something went wrong signing in with Planning Center. Please try again.";

/** Maps Better Auth / OAuth `?error=` codes to calm, human copy. */
export const describeSignInError = (code: string | null): string | null => {
  if (code === null || code === "") {
    return null;
  }
  return SIGN_IN_ERROR_MESSAGES.get(code) ?? GENERIC_SIGN_IN_ERROR;
};
