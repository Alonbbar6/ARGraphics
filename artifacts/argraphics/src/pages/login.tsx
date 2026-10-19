import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useGetSession, useLogin, useRegister, getGetSessionQueryKey, type PartnerKind } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, LockKeyhole, Palette, Store, Truck } from 'lucide-react';
import { Button, Field, inputClass, SegmentedControl } from '@/components/partner-ui';
import { Wordmark } from '@/components/shell';

function AuthLayout({ children, aside }: { children: ReactNode; aside: { eyebrow: string; headline: string; body: string } }) {
  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden md:grid-cols-[1fr_.85fr]">
      <div className="absolute left-[-8rem] top-[-8rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
      <section className="relative flex flex-col px-4 py-6 sm:px-10 md:px-16 md:py-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex min-h-11 items-center" aria-label="ARGraphics home"><Wordmark /></Link>
          <Link href="/" className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} aria-hidden="true" /> Back to home</Link>
        </div>
        <div className="mx-auto my-auto w-full py-12" style={{ maxWidth: '28rem' }}>{children}</div>
        <p className="text-xs text-muted-foreground">Questions? <a className="underline underline-offset-4" href="mailto:hello@argraphics.app">hello@argraphics.app</a></p>
      </section>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0B0B14] p-10 text-white md:flex lg:p-16">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_25%,#6D28D9_0%,transparent_50%),radial-gradient(ellipse_at_20%_95%,#F43F5E99_0%,transparent_45%)]" aria-hidden="true" />
        <div className="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#FDE68A]"><span className="h-px w-7 bg-[#FDE68A]" aria-hidden="true" /> {aside.eyebrow}</div>
        <div className="relative w-full" style={{ maxWidth: '36rem' }}>
          <p className="serif text-6xl leading-[1.03]">{aside.headline}</p>
          <p className="mt-6 leading-7 text-white/75" style={{ maxWidth: '28rem' }}>{aside.body}</p>
        </div>
        <div className="relative border-t border-white/15 pt-5 text-xs text-white/65">Independent bars, restaurants and local artists.</div>
      </aside>
    </main>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [location, setLocation] = useLocation();
  const session = useGetSession();
  const login = useLogin();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session.data?.authenticated && location === '/login') setLocation('/home');
  }, [session.data?.authenticated, location, setLocation]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    login.mutate({ data: { email, password } }, {
      onSuccess: (result) => {
        queryClient.clear();
        queryClient.setQueryData(getGetSessionQueryKey(), result);
        setLocation(result.partnerKind === 'artist' ? '/artist' : '/home');
      },
      onError: (error) => {
        const status = 'status' in error ? error.status : undefined;
        setErrorMessage(status === 429
          ? 'Too many sign-in attempts. Wait an hour, or reset your password below.'
          : 'That sign-in didn’t work. Check your details and try again.');
      },
    });
  };

  return (
    <AuthLayout aside={{ eyebrow: 'Between rushes', headline: 'See who came by because of it.', body: 'Scans, redemptions and regulars, counted for you. Check it on your phone between tables.' }}>
      <h1 className="serif text-5xl leading-tight">Welcome back.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Sign in to see this week’s scans and redemptions.</p>
      {import.meta.env.DEV && <p className="mt-5 rounded-xl border border-border bg-card/70 px-4 py-3 text-xs text-muted-foreground">
        Development demo only: <span className="font-semibold text-foreground">demo@argraphics.app</span>
        <br />
        Password: <span className="font-semibold text-foreground">ARGraphics-demo-2026!</span>
      </p>}
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Email address"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} placeholder="you@yourspot.com" data-testid="input-login-email" /></Field>
        <Field label="Password"><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} placeholder="Your password" data-testid="input-login-password" /></Field>
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4" data-testid="link-forgot-password">Forgot your password?</Link>
        {errorMessage && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{errorMessage}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={login.isPending} loadingText="One moment…" data-testid="button-login-submit">Sign in <ArrowRight size={17} aria-hidden="true" /></Button>
      </form>
      <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"><LockKeyhole size={13} aria-hidden="true" /> Your numbers are private to your account.</p>
      <p className="mt-8 text-center text-sm text-muted-foreground">New to ARGraphics? <Link href="/welcome" className="font-semibold text-primary underline underline-offset-4">Set up your spot</Link></p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const params = new URLSearchParams(window.location.search);
  const referral = params.get('ref');
  const [kind, setKind] = useState<PartnerKind>(params.get('kind') === 'artist' ? 'artist' : 'venue');
  const [venueType, setVenueType] = useState<'restaurant' | 'truck'>(params.get('kind') === 'truck' ? 'truck' : 'restaurant');
  const account = kind === 'artist' ? 'artist' : venueType;
  const chooseAccount = (value: string) => {
    if (value === 'artist') { setKind('artist'); return; }
    setKind('venue');
    setVenueType(value === 'truck' ? 'truck' : 'restaurant');
  };
  const [name, setName] = useState('');
  const [barName, setBarName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [location, setLocation] = useLocation();
  const session = useGetSession();
  const register = useRegister();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session.data?.authenticated && location === '/register') setLocation('/home');
  }, [session.data?.authenticated, location, setLocation]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    register.mutate({ data: { name, barName, email, password, kind, ...(kind === 'venue' ? { venueType } : {}) } }, {
      onSuccess: (result) => {
        queryClient.clear();
        queryClient.setQueryData(getGetSessionQueryKey(), result);
        setLocation('/welcome');
      },
      onError: (error) => {
        const status = 'status' in error ? error.status : undefined;
        setErrorMessage(status === 409
          ? 'An account with that email already exists. Sign in instead.'
          : 'We couldn’t create your account. Check your details and try again.');
      },
    });
  };

  const artist = kind === 'artist';
  return (
    <AuthLayout aside={artist
      ? { eyebrow: 'For local artists', headline: 'Your work, on walls people already go to.', body: 'Venues host your pieces in AR. Guests see them in the room, and you see every scan.' }
      : { eyebrow: 'For independent spots', headline: 'Fill the slow hours.', body: 'Put something out front that people can only see at your spot, and see exactly who came in because of it.' }}>
      <h1 className="serif text-5xl leading-tight">{artist ? 'Put your work in the room.' : 'Give people a reason to come by.'}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{referral ? 'An ARGraphics artist invited you. ' : ''}Takes about two minutes. No contract.</p>
      <form onSubmit={submit} className="mt-7 space-y-3.5">
        <SegmentedControl label="Account type" value={account} onChange={chooseAccount} options={[{ value: 'restaurant', label: 'Bar or restaurant', icon: Store }, { value: 'truck', label: 'Food truck or stand', icon: Truck }, { value: 'artist', label: 'I’m an artist', icon: Palette }]} />
        <Field label="Your name"><input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Marisol Vega" /></Field>
        <Field label={artist ? 'Artist or studio name' : 'Venue name'}><input required minLength={2} maxLength={80} autoComplete="organization" value={barName} onChange={(event) => setBarName(event.target.value)} className={inputClass} placeholder={artist ? 'Ana Ruiz Studio' : 'Casa Marisol'} /></Field>
        <Field label="Email address"><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} placeholder="you@yourspot.com" /></Field>
        <Field label="Password" hint="Use at least 12 characters."><input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} placeholder="At least 12 characters" /></Field>
        {errorMessage && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{errorMessage}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={register.isPending} loadingText="Setting things up…">Create account <ArrowRight size={17} aria-hidden="true" /></Button>
      </form>
      <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"><LockKeyhole size={13} aria-hidden="true" /> Your numbers are private to your account.</p>
      <p className="mt-7 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-semibold text-primary underline underline-offset-4">Sign in</Link></p>
    </AuthLayout>
  );
}
