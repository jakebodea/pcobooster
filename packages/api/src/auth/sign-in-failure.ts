/**
 * Typed reading of the `?error=` code Better Auth puts on a failed OAuth callback redirect.
 * Better Auth only logs these codes, so the sign-in hook parses them here and records them
 * instead of letting them disappear behind the sign-in page's generic message.
 */
import { Data, Option, Schema } from "effect";

/** Codes the Planning Center callback can redirect with (Better Auth 1.7 `OAUTH_CALLBACK_ERROR_CODES` and link results). */
export const signInFailureCodes = [
  "access_denied",
  "account_not_linked",
  "account_already_linked_to_different_user",
  "email_not_found",
  "email_not_verified",
  "email_does_not_match",
  "internal_server_error",
  "invalid_callback_request",
  "invalid_code",
  "no_callback_url",
  "no_code",
  "oauth_provider_not_found",
  "please_restart_the_process",
  "signup_disabled",
  "state_mismatch",
  "state_not_found",
  "unable_to_create_session",
  "unable_to_create_user",
  "unable_to_get_user_info",
  "unable_to_link_account",
  "unable_to_update_account",
] as const;

const signInFailureCodeSchema = Schema.Literals(signInFailureCodes);
export type SignInFailureCode = typeof signInFailureCodeSchema.Type;

const decodeSignInFailureCode = Schema.decodeUnknownOption(
  signInFailureCodeSchema
);

export class SignInFailure extends Data.TaggedError("SignInFailure")<{
  /** A known code, or `unknown` when Better Auth or the provider sends a new one. */
  readonly code: SignInFailureCode | "unknown";
  /** The code as received, kept for codes this list does not know yet. */
  readonly receivedCode: string;
  readonly description: string | null;
}> {}

/** The failure a callback redirect reports, or null when the redirect carries no error. */
export const parseSignInFailure = (
  location: string | null | undefined
): SignInFailure | null => {
  if (location === null || location === undefined || location === "") {
    return null;
  }
  let url: URL;
  try {
    // Relative redirects resolve against a placeholder; only the query matters.
    url = new URL(location, "http://callback.invalid");
  } catch {
    return null;
  }
  const receivedCode = url.searchParams.get("error");
  if (receivedCode === null || receivedCode === "") {
    return null;
  }
  return new SignInFailure({
    code: Option.getOrElse(
      decodeSignInFailureCode(receivedCode),
      (): "unknown" => "unknown"
    ),
    receivedCode,
    description: url.searchParams.get("error_description"),
  });
};
