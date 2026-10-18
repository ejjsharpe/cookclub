import { useState } from "react";

import { authClient } from "../lib/auth";
import { getPasswordResetUrl } from "../lib/runtime-config";

export function ForgotPasswordForm({
  initialEmail,
  onBack,
}: {
  initialEmail: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="form-stack">
      <h2>{sent ? "Check your email" : "Forgot password?"}</h2>
      <p role="status">
        {sent
          ? "If an account exists for that email, you'll receive a reset link. Check your spam folder too. The link expires in one hour."
          : "Enter your admin account email and we'll send you a link to choose a new password."}
      </p>
      {sent ? (
        <button
          className="secondary-button"
          type="button"
          onClick={() => setSent(false)}
        >
          Request another link
        </button>
      ) : (
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError(null);
            try {
              const result = await authClient.requestPasswordReset({
                email: email.trim(),
                redirectTo: getPasswordResetUrl(),
              });
              if (result.error) {
                setError(
                  result.error.status === 429
                    ? "Too many requests. Please try again later."
                    : "We couldn't request a reset link. Please try again.",
                );
              } else {
                setSent(true);
              }
            } catch {
              setError(
                "Couldn't connect to cookclub. Check your connection and try again.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              disabled={pending}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <button
        className="secondary-button"
        type="button"
        disabled={pending}
        onClick={onBack}
      >
        Back to sign in
      </button>
    </div>
  );
}
