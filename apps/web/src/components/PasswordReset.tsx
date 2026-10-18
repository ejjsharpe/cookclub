import { useEffect, useState } from "react";

import "../styles/password-reset.css";

type Props = { apiBaseUrl: string; adminSignInUrl: string };
type Mode = "loading" | "request" | "reset" | "sent" | "success";

const INVALID_LINK =
  "This reset link has expired or has already been used. Request a new link below.";

export default function PasswordReset({ apiBaseUrl, adminSignInUrl }: Props) {
  const [mode, setMode] = useState<Mode>("loading");
  const [token, setToken] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const resetToken =
      new URLSearchParams(url.hash.slice(1)).get("token") ??
      url.searchParams.get("token");
    const invalid = url.searchParams.has("error");
    setIsAdmin(url.searchParams.get("source") === "admin");
    setToken(invalid ? "" : (resetToken ?? ""));
    setMode(resetToken && !invalid ? "reset" : "request");
    if (invalid) setError(INVALID_LINK);

    // Keep the token only in memory. Reloading requires reopening the email.
    url.searchParams.delete("token");
    url.searchParams.delete("error");
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
  }, []);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (mode !== "request" && mode !== "reset")) return;
    setError(null);
    if (mode === "reset") {
      if (password.length < 8 || password.length > 128) {
        setError("Choose a password between 8 and 128 characters.");
        return;
      }
      if (password !== confirmation) {
        setError("Your passwords don't match.");
        return;
      }
    }

    setPending(true);
    try {
      const resetting = mode === "reset";
      const redirect = new URL("/reset-password", window.location.origin);
      if (isAdmin) redirect.searchParams.set("source", "admin");
      const response = await fetch(
        `${apiBaseUrl.replace(/\/+$/, "")}/auth/${resetting ? "reset-password" : "request-password-reset"}`,
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            resetting
              ? { token, newPassword: password }
              : { email: email.trim(), redirectTo: redirect.toString() },
          ),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        code?: string;
        status?: boolean;
      } | null;
      if (!response.ok || result?.status !== true) {
        if (resetting && result?.code === "INVALID_TOKEN") {
          setToken("");
          setPassword("");
          setConfirmation("");
          setMode("request");
          setError(INVALID_LINK);
        } else if (response.status === 429) {
          setError(
            "Too many requests. Please wait a few minutes and try again.",
          );
        } else if (
          result?.code === "PASSWORD_TOO_SHORT" ||
          result?.code === "PASSWORD_TOO_LONG"
        ) {
          setError("Choose a password between 8 and 128 characters.");
        } else {
          setError("We couldn't complete your request. Please try again.");
        }
        return;
      }
      setMode(resetting ? "success" : "sent");
      setToken("");
      setPassword("");
      setConfirmation("");
    } catch {
      setError(
        "Couldn't connect to cookclub. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  function requestAnother() {
    setToken("");
    setPassword("");
    setConfirmation("");
    setError(null);
    setMode("request");
  }

  const title =
    mode === "sent"
      ? "Check your email"
      : mode === "success"
        ? "Password updated"
        : mode === "reset"
          ? "Choose a new password"
          : "Reset your password";

  return (
    <section
      className="password-reset"
      aria-labelledby="reset-title"
      aria-busy={pending}
    >
      <p className="password-reset__eyebrow">
        cookclub{isAdmin ? " Admin" : ""}
      </p>
      <h1 id="reset-title">{title}</h1>
      {mode === "loading" && <p role="status">Loading…</p>}
      {mode === "request" && (
        <p>
          Enter your account email and we'll send you a link to choose a new
          password.
        </p>
      )}
      {mode === "reset" && (
        <p>
          Use 8–128 characters. You'll sign in again with your new password.
        </p>
      )}
      {mode === "sent" && (
        <div role="status">
          <p>
            If an account exists for that email, you'll receive a reset link.
            Check your spam folder too.
          </p>
          <p>The link expires in one hour and can only be used once.</p>
        </div>
      )}
      {mode === "success" && (
        <div role="status">
          <p>
            Your password has been changed and your existing sessions have been
            signed out.
          </p>
          <p>
            {isAdmin
              ? "Return to the admin sign-in page to continue."
              : "Return to the cookclub app and sign in with your new password."}
          </p>
        </div>
      )}
      {(mode === "request" || mode === "reset") && (
        <form onSubmit={submit} className="password-reset__form">
          {mode === "request" ? (
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                disabled={pending}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                New password
                <input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={pending}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={pending}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p className="password-reset__error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="password-reset__primary"
          >
            {pending
              ? "Please wait…"
              : mode === "reset"
                ? "Save new password"
                : "Send reset link"}
          </button>
        </form>
      )}
      {(mode === "sent" || mode === "reset") && (
        <button
          type="button"
          className="password-reset__link"
          disabled={pending}
          onClick={requestAnother}
        >
          Request another link
        </button>
      )}
      {mode !== "loading" && (
        <a
          className="password-reset__link"
          href={isAdmin ? adminSignInUrl : "cookclub://"}
        >
          {isAdmin ? "Back to admin sign in" : "Open cookclub"}
        </a>
      )}
      <p className="password-reset__help">
        Need help? <a href="/support">Contact support</a>
      </p>
    </section>
  );
}
