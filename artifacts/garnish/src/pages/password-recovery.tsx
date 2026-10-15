import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useRequestPasswordReset, useConfirmPasswordReset } from '@workspace/api-client-react';
import { ArrowLeft, GlassWater, LoaderCircle } from 'lucide-react';

function RecoveryLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | Garnish`;
    const meta = document.querySelector('meta[name="description"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const oldValues = [meta, ogTitle, ogDescription].map(node => node?.getAttribute('content') ?? '');
    meta?.setAttribute('content', description);
    ogTitle?.setAttribute('content', `${title} | Garnish`);
    ogDescription?.setAttribute('content', description);
    return () => {
      document.title = previous;
      [meta, ogTitle, ogDescription].forEach((node, i) => node?.setAttribute('content', oldValues[i]));
    };
  }, [title, description]);
  return (
    <main className="relative flex min-h-[100dvh] flex-col px-5 py-6 sm:px-10 md:px-16 md:py-10">
      <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-bold">
        <span className="grid h-8 w-8 place-items-center rounded-lg last-call text-[#26141d]"><GlassWater size={17} /></span>garnish<span className="text-primary">.</span>
      </Link>
      <section className="mx-auto my-auto w-full py-14" style={{ width: '100%', maxWidth: '28rem' }}>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[.22em] text-primary">Your bar account</p>
        <h1 className="serif text-5xl leading-tight">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        {children}
        <Link href="/login" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={15} /> Back to sign in</Link>
      </section>
    </main>
  );
}

const inputClass = 'mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary';
const buttonClass = 'flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const request = useRequestPasswordReset();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    request.mutate({ data: { email: email.trim().toLowerCase() } }, {
      onSuccess: result => setMessage(result.message),
      onError: error => {
        const status = 'status' in error ? error.status : undefined;
        setError(status === 429 ? 'Too many requests. Please try again in an hour.'
          : status === 400 ? 'Enter a valid email address.'
          : 'Password recovery is temporarily unavailable. Please try again later.');
      },
    });
  };
  return (
    <RecoveryLayout title="Forgot your password?" description="Enter the email you used to register. We’ll send a link to reset your password.">
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block text-sm font-medium">Email address
          <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className={inputClass} placeholder="you@yourbar.com" data-testid="input-recovery-email" />
        </label>
        {message && <p role="status" className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={request.isPending} className={buttonClass} data-testid="button-recovery-submit">
          {request.isPending ? <><LoaderCircle size={17} className="animate-spin" /> Sending…</> : 'Send reset link'}
        </button>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">Links expire after 30 minutes. If you don’t see an email, check spam and make sure you entered your registration email. You need access to that inbox.</p>
    </RecoveryLayout>
  );
}

export function ResetPasswordPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reset = useConfirmPasswordReset();
  const queryClient = useQueryClient();
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  useEffect(() => {
    // Keep the token only in component memory, not in history or web storage.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    if (new TextEncoder().encode(password).length > 72) { setError('Use a password no longer than 72 bytes.'); return; }
    reset.mutate({ data: { token, password } }, {
      onSuccess: result => {
        queryClient.clear();
        setPassword('');
        setConfirm('');
        setMessage(result.message);
      },
      onError: error => {
        const status = 'status' in error ? error.status : undefined;
        setError(status === 400 ? 'This reset link is invalid, expired, or already used. Request a new link.'
          : status === 429 ? 'Too many reset attempts. Please try again in an hour.'
          : 'Your password could not be updated. Please try again.');
      },
    });
  };
  return (
    <RecoveryLayout title="Set a new password" description="Choose a password of at least 12 characters and no more than 72 bytes.">
      {message ? <div role="status" className="mt-8 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">{message}</div>
        : !validToken ? <p role="alert" className="mt-8 text-sm text-destructive">This reset link is missing or invalid. Request a new link.</p>
        : <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-sm font-medium">New password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} data-testid="input-reset-password" /></label>
          <label className="block text-sm font-medium">Confirm new password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className={inputClass} data-testid="input-reset-confirm" /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={reset.isPending} className={buttonClass} data-testid="button-reset-submit">
            {reset.isPending ? <><LoaderCircle size={17} className="animate-spin" /> Updating…</> : 'Update password'}
          </button>
        </form>}
      {!message && <Link href="/forgot-password" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4">Request a new reset link</Link>}
    </RecoveryLayout>
  );
}
