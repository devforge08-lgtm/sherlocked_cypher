
import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function MagicLinkAuth() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSent(false);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;

      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not send the sign-in link.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Sign in to QuickCart</h2>
      <p className="mt-2 text-sm text-slate-600">
        No password needed. We'll email you a secure sign-in link.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="magic-email"
            className="mb-1 block text-sm font-medium"
          >
            Email address
          </label>
          <input
            id="magic-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-3"
            required
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {sent && (
          <div
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            <p className="font-semibold">Check your inbox!</p>
            <p className="mt-1">
              We've requested a sign-in link for {email}. Open it in this
              browser to finish signing in.
            </p>
            <button
              type="button"
              className="mt-2 font-semibold underline"
              onClick={() => setSent(false)}
            >
              Try another email
            </button>
          </div>
        )}

        {!sent && (
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 p-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Sending link...' : 'Email me a sign-in link'}
          </button>
        )}
      </form>
    </section>
  );
}
