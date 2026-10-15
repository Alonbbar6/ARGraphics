import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useGetSession, useLogin, useRegister, getGetSessionQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, GlassWater, LoaderCircle, LockKeyhole } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [location, setLocation] = useLocation();
  const session = useGetSession();
  const login = useLogin();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session.data?.authenticated && location === '/login') setLocation('/drinks');
  }, [session.data?.authenticated, location, setLocation]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    login.mutate({ data: { email, password } }, {
      onSuccess: (result) => {
        queryClient.clear();
        queryClient.setQueryData(getGetSessionQueryKey(), result);
        setLocation('/drinks');
      },
      onError: () => setErrorMessage('That sign-in didn’t work. Check your details and try again.'),
    });
  };

  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden md:grid-cols-[1fr_.85fr]">
      <div className="absolute left-[-8rem] top-[-8rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <section className="relative flex flex-col px-5 py-6 sm:px-10 md:px-16 md:py-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-lg last-call text-[#26141d]"><GlassWater size={17} /></span>garnish<span className="text-primary">.</span></Link>
          <Link href="/" className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Back to home</Link>
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-14" style={{ width: '100%', maxWidth: '28rem' }}>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[.22em] text-primary">Good to have you back</p>
          <h1 className="serif text-5xl leading-tight">Back behind<br />the bar.</h1>
          <p className="mt-3 text-sm text-muted-foreground">Sign in to give tonight’s menu a look.</p>
          {import.meta.env.DEV && <p className="mt-5 rounded-xl border border-border bg-card/70 px-4 py-3 text-xs text-muted-foreground">
            Development demo only: <span className="font-semibold text-foreground">demo@garnish.app</span>
            <br />
            Password: <span className="font-semibold text-foreground">Garnish-demo-2026!</span>
          </p>}
          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block text-sm font-medium">Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary" placeholder="you@yourbar.com" data-testid="input-login-email" /></label>
            <label className="block text-sm font-medium">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary" placeholder="Your password" data-testid="input-login-password" /></label>
            <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4" data-testid="link-forgot-password">Forgot your password?</Link>
            {errorMessage && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{errorMessage}</p>}
            <button type="submit" disabled={login.isPending} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-login-submit">
              {login.isPending ? <><LoaderCircle size={17} className="animate-spin" /> One moment…</> : <>Sign in <ArrowRight size={17} /></>}
            </button>
          </form>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"><LockKeyhole size={13} /> Your bar details stay yours.</p>
          <p className="mt-8 text-center text-sm text-muted-foreground">New to Garnish? <Link href="/register" className="font-semibold text-primary underline underline-offset-4">Create your bar account</Link></p>
        </div>
        <p className="text-xs text-muted-foreground">A good menu makes room for another round.</p>
      </section>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#241a27] p-10 text-[#f3e8dc] md:flex lg:p-16">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,#653752_0%,transparent_54%)]" />
        <div className="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#e9a366]"><span className="h-px w-7 bg-[#e9a366]" /> Your shift, your menu</div>
        <div className="relative w-full max-w-xl" style={{ width: '100%', maxWidth: '36rem' }}>
          <div className="mb-8 grid h-16 w-16 place-items-center rounded-2xl last-call text-[#281720]"><GlassWater size={28} /></div>
          <p className="serif text-6xl leading-[1.03]">Give the good stuff a closer look.</p>
          <p className="mt-6 w-full max-w-md leading-7 text-[#cbbbc5]" style={{ width: '100%', maxWidth: '28rem' }}>Keep your drinks in order, catch the details guests notice, and get back to what you do best.</p>
        </div>
        <div className="relative flex items-center justify-between border-t border-white/15 pt-5 text-xs text-[#b9a9b3]"><span>Independent bars. Independent spirit.</span><Link href="/" className="flex min-h-11 items-center gap-2 text-[#f0a56d]">Our story <ArrowRight size={14} /></Link></div>
      </aside>
    </main>
  );
}

export function RegisterPage() {
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
    if (session.data?.authenticated && location === '/register') setLocation('/drinks');
  }, [session.data?.authenticated, location, setLocation]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    register.mutate({ data: { name, barName, email, password } }, {
      onSuccess: (result) => {
        queryClient.clear();
        queryClient.setQueryData(getGetSessionQueryKey(), result);
        setLocation('/drinks');
      },
      onError: (error) => {
        const status = 'status' in error ? error.status : undefined;
        setErrorMessage(status === 409
          ? 'An account with that email already exists. Sign in instead.'
          : 'We couldn’t create your account. Check your details and try again.');
      },
    });
  };

  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden md:grid-cols-[1fr_.85fr]">
      <div className="absolute left-[-8rem] top-[-8rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <section className="relative flex flex-col px-5 py-6 sm:px-10 md:px-16 md:py-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-lg last-call text-[#26141d]"><GlassWater size={17} /></span>garnish<span className="text-primary">.</span></Link>
          <Link href="/" className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Back to home</Link>
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-12" style={{ width: '100%', maxWidth: '28rem' }}>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[.22em] text-primary">Your bar, your menu</p>
          <h1 className="serif text-5xl leading-tight">Set up your<br />own bar.</h1>
          <p className="mt-3 text-sm text-muted-foreground">Create a private menu workspace for your team.</p>
          <form onSubmit={submit} className="mt-7 space-y-3.5">
            <label className="block text-sm font-medium">Your name<input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary" placeholder="Alex Morgan" /></label>
            <label className="block text-sm font-medium">Bar name<input required minLength={2} maxLength={80} autoComplete="organization" value={barName} onChange={(event) => setBarName(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary" placeholder="The Juniper Room" /></label>
            <label className="block text-sm font-medium">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary" placeholder="you@yourbar.com" /></label>
            <label className="block text-sm font-medium">Password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary" placeholder="At least 12 characters" /><span className="mt-1 block text-xs text-muted-foreground">Use at least 12 characters.</span></label>
            {errorMessage && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{errorMessage}</p>}
            <button type="submit" disabled={register.isPending} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60">
              {register.isPending ? <><LoaderCircle size={17} className="animate-spin" /> Setting things up…</> : <>Create account <ArrowRight size={17} /></>}
            </button>
          </form>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"><LockKeyhole size={13} /> Your menu is private to your bar account.</p>
          <p className="mt-7 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-semibold text-primary underline underline-offset-4">Sign in</Link></p>
        </div>
        <p className="text-xs text-muted-foreground">A good menu makes room for another round.</p>
      </section>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#241a27] p-10 text-[#f3e8dc] md:flex lg:p-16">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,#653752_0%,transparent_54%)]" />
        <div className="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#e9a366]"><span className="h-px w-7 bg-[#e9a366]" /> Independent bars. Independent spirit.</div>
        <div className="relative w-full max-w-xl" style={{ width: '100%', maxWidth: '36rem' }}>
          <div className="mb-8 grid h-16 w-16 place-items-center rounded-2xl last-call text-[#281720]"><GlassWater size={28} /></div>
          <p className="serif text-6xl leading-[1.03]">A workspace made for your bar.</p>
          <p className="mt-6 w-full max-w-md leading-7 text-[#cbbbc5]" style={{ width: '100%', maxWidth: '28rem' }}>Your drinks, prices and menu settings start in their own private account.</p>
        </div>
        <div className="relative flex items-center justify-between border-t border-white/15 pt-5 text-xs text-[#b9a9b3]"><span>Your menu starts here.</span><Link href="/" className="flex min-h-11 items-center gap-2 text-[#f0a56d]">Garnish home <ArrowRight size={14} /></Link></div>
      </aside>
    </main>
  );
}
