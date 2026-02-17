import { FormEvent, useState } from "react";

interface LoginViewProps {
  loading: boolean;
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginView({ loading, error, onLogin }: LoginViewProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (loading) {
      return;
    }

    await onLogin(email.trim(), password);
  };

  return (
    <section className="panel auth-panel">
      <header className="panel-header">
        <h2>Sign in to Companion</h2>
      </header>
      <p className="muted">Use your admin credentials configured in Railway.</p>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}
