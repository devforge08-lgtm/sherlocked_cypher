
import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthForm() {
  const [isSignup, setIsSignup] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
          },
        });

        if (error) throw error;

        if (data.session) {
          setMessage('Account created! You are now signed in.');
        } else {
          setMessage(
            'Account created. Check your email to confirm your account, then sign in.',
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        setMessage('Login successful!');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">
        {isSignup ? 'Create your account' : 'Welcome back'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {isSignup
          ? 'Join QuickCart for convenient local delivery.'
          : 'Sign in to your QuickCart account.'}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {isSignup && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Full name
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 p-3"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 p-3"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 p-3"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 p-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading
            ? 'Please wait...'
            : isSignup
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-600">
        {isSignup ? 'Already have an account?' : 'New to QuickCart?'}{' '}
        <button
          type="button"
          className="font-semibold text-emerald-700 hover:underline"
          onClick={() => {
            setIsSignup(!isSignup);
            setError('');
            setMessage('');
          }}
        >
          {isSignup ? 'Sign in' : 'Create account'}
        </button>
      </p>
    </section>
  );
}
