import { Link } from 'wouter';
import { ArrowDown, ArrowRight, Camera, Check, ChevronRight, CirclePlay, GlassWater, MoveUpRight, ScanLine, Sparkles, TrendingUp, WandSparkles } from 'lucide-react';

function Wordmark() {
  return <Link href="/" className="flex min-h-11 items-center gap-2.5 text-xl font-bold tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-xl last-call text-[#26141d]"><GlassWater size={19} /></span>garnish<span className="text-primary">.</span></Link>;
}

function MenuPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[430px] rotate-[2deg]">
      <div className="absolute -right-5 top-12 h-72 w-72 rounded-full bg-[#e58b51]/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[2.4rem] border border-white/15 bg-[#261923] p-3 shadow-2xl shadow-black/30">
        <div className="overflow-hidden rounded-[1.9rem] bg-[#f2e8dd] text-[#312333]">
          <div className="last-call flex items-center justify-between px-5 py-4 text-[#291721]">
            <span className="text-[10px] font-bold uppercase tracking-[.22em]">Tonight at</span><span className="serif text-xl">The Juniper Room</span>
          </div>
          <div className="px-5 pb-5 pt-4">
            <div className="mb-4 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.2em] text-[#8c6d71]">House signatures</span><span className="rounded-full bg-[#e8d5d3] px-2.5 py-1 text-[9px] font-semibold">4 pours</span></div>
            <div className="rounded-2xl bg-[#e9d6d0] p-3">
              <div className="relative mb-3 grid h-[185px] place-items-center overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_54%_66%,#f7c079_0%,#d76457_31%,#863a5a_64%,#3a2439_100%)]">
                <div className="absolute left-8 top-8 h-24 w-24 rounded-full border border-white/30" />
                <div className="absolute bottom-4 right-5 h-28 w-28 rounded-full border border-white/25" />
                <div className="relative flex h-32 w-24 -rotate-6 flex-col items-center overflow-hidden rounded-b-[2.5rem] rounded-t-lg border border-white/45 bg-gradient-to-b from-white/40 via-[#f1a35e]/70 to-[#b74658]/90 shadow-xl backdrop-blur">
                  <div className="absolute left-3 top-4 h-10 w-10 rounded-full border-[7px] border-[#e6b35e] bg-transparent" />
                  <span className="absolute bottom-5 h-3 w-3 rounded-full bg-[#5c9367]" />
                  <span className="absolute -right-1 top-1 h-24 w-1 rotate-12 rounded-full bg-white/70" />
                </div>
                <div className="absolute right-3 top-3 rounded-full bg-[#2b1e2c]/75 px-2.5 py-1.5 text-[9px] font-semibold text-white"><ScanLine size={11} className="mr-1 inline" /> Tap to see it</div>
              </div>
              <div className="flex items-end justify-between px-1">
                <div><p className="serif text-[23px] leading-none">Blood Orange Bloom</p><p className="mt-2 text-[10px] text-[#795f6a]">Gin · blood orange · rosemary</p></div><span className="text-sm font-semibold">$16</span>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <div className="h-12 flex-1 rounded-xl bg-[#dfd1d0] p-2"><p className="serif text-sm">Low Tide</p><p className="text-[9px] text-[#795f6a]">Sea salt · pear</p></div>
              <div className="h-12 flex-1 rounded-xl bg-[#dfd1d0] p-2"><p className="serif text-sm">Velvet Hour</p><p className="text-[9px] text-[#795f6a]">Rye · fig · cacao</p></div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-7 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#302333] px-4 py-3 shadow-xl">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f2ae55] text-[#302333]"><Camera size={17} /></span>
        <span><span className="block text-xs font-semibold text-[#f3e8dc]">Made for the moment</span><span className="mt-1 block text-[10px] text-[#b7a9b2]">One tap. Full pour.</span></span>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="overflow-hidden">
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-8 text-sm text-foreground/70 md:flex" aria-label="Marketing">
          <a href="#how-it-works" className="min-h-11 content-center hover:text-foreground">How it works</a>
          <a href="#why-garnish" className="min-h-11 content-center hover:text-foreground">Why Garnish</a>
          <a href="#stories" className="min-h-11 content-center hover:text-foreground">From the bar</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden min-h-11 items-center px-4 text-sm font-medium sm:flex">Sign in</Link>
          <Link href="/login" className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Try it free <ArrowRight size={15} /></Link>
        </div>
      </header>
      <main>
        <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 pb-24 pt-12 sm:px-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] md:gap-14 md:pb-32 md:pt-20">
          <div className="relative z-10 min-w-0 rise">
            <p className="mb-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.23em] text-primary"><span className="h-px w-7 bg-primary" /> A better first sip starts here</p>
            <h1 className="serif max-w-none text-[clamp(3.2rem,7vw,6.5rem)] leading-[.91] tracking-[-.045em]">Nobody can<br /><em className="text-primary">taste</em> a menu.</h1>
            <p className="mt-7 w-full text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8" style={{ maxWidth: '36rem' }}>Your bartender spent three weeks on that cocktail. Your guests skimmed right past it. Garnish makes your drinks rise off the table in 3D, so guests see them, order them, and film them.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-primary px-6 font-semibold text-primary-foreground shadow-lg shadow-primary/20">Try it free for 30 days <ArrowRight size={17} /></Link>
              <a href="#how-it-works" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border px-5 text-sm font-semibold hover:bg-muted"><CirclePlay size={17} /> See how it works</a>
            </div>
            <div className="mt-8 flex items-center gap-4 text-xs text-muted-foreground"><span className="flex -space-x-2"><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-background bg-[#9b6c76] text-[10px] font-bold text-white">J</span><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-background bg-[#d29352] text-[10px] font-bold text-white">M</span><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-background bg-[#6f7e69] text-[10px] font-bold text-white">A</span></span><span>For the people behind the bar.</span></div>
          </div>
          <div className="relative min-w-0 py-10 md:py-0"><MenuPreview /></div>
          <a href="#how-it-works" className="absolute bottom-8 left-8 hidden items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground md:flex"><ArrowDown size={15} /> Scroll for the good stuff</a>
        </section>

        <section className="last-call px-5 py-5 text-[#291721] sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-12 gap-y-3 text-center text-xs font-bold uppercase tracking-[.16em] sm:justify-between">
            <span>More than a menu</span><span className="hidden h-1 w-1 rounded-full bg-[#3a2030]/50 sm:block" /><span>Made for independent bars</span><span className="hidden h-1 w-1 rounded-full bg-[#3a2030]/50 sm:block" /><span>Built for the next round</span>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 md:py-32">
          <div className="grid gap-12 md:grid-cols-[.8fr_1.2fr]">
            <div><p className="mb-4 text-[11px] font-bold uppercase tracking-[.22em] text-primary">01 / Set the scene</p><h2 className="serif text-5xl leading-[1.03] sm:text-6xl">A menu with<br />a little <em>lift.</em></h2></div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="border-t border-border pt-5"><span className="serif text-4xl text-primary">01</span><h3 className="mt-4 text-lg font-semibold">Add the drinks you love</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Names, notes, prices. You know the drinks. We make them look as good as they taste.</p></div>
              <div className="border-t border-border pt-5"><span className="serif text-4xl text-primary">02</span><h3 className="mt-4 text-lg font-semibold">Give guests the close-up</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">A quick scan turns a flat card into an in-the-room look at what’s in the glass.</p></div>
            </div>
          </div>
          <div className="mt-16 grid overflow-hidden rounded-[2rem] border border-border bg-card md:grid-cols-[1.1fr_.9fr]">
            <div className="flex min-h-[300px] items-center justify-center bg-[radial-gradient(ellipse_at_50%_60%,#9b4763_0%,#49263f_46%,#211924_85%)] p-8">
              <div className="relative grid h-56 w-56 place-items-center rounded-full border border-white/15">
                <div className="absolute h-44 w-44 rounded-full border border-white/10" />
                <div className="relative flex h-40 w-28 -rotate-6 items-end justify-center overflow-hidden rounded-b-[3rem] rounded-t-xl border border-white/40 bg-gradient-to-b from-[#e9b45f]/75 via-[#e37d53]/85 to-[#8e3e64]/95 shadow-xl">
                  <div className="mb-8 h-14 w-14 rounded-full border-[9px] border-[#eacb76] opacity-90" />
                  <span className="absolute right-4 top-3 h-28 w-1 rotate-12 rounded-full bg-white/70" />
                </div>
                <span className="absolute -right-9 top-4 rounded-full bg-[#f1ae58] px-3 py-2 text-xs font-bold text-[#352231]">360°</span>
              </div>
            </div>
            <div className="flex flex-col justify-center p-7 sm:p-12"><Sparkles className="mb-6 text-primary" size={20} /><h3 className="serif text-4xl leading-tight">The detail is the difference.</h3><p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">Garnish lets your menu do what a good bartender does: make the next choice feel obvious. Every ingredient, garnish and gorgeous little detail gets its moment.</p><a href="#why-garnish" className="mt-7 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary">Meet the details <ArrowRight size={15} /></a></div>
          </div>
        </section>

        <section id="why-garnish" className="bg-[#241a27] px-5 py-24 text-[#f3e8dc] sm:px-8 md:py-32">
          <div className="mx-auto grid max-w-7xl gap-14 md:grid-cols-[1fr_1fr] md:items-center">
            <div><p className="mb-4 text-[11px] font-bold uppercase tracking-[.22em] text-[#ee9c60]">02 / Make the menu move</p><h2 className="serif text-5xl leading-[1.02] sm:text-6xl">A little theater.<br />A lot more <em>curiosity.</em></h2><p className="mt-6 max-w-lg leading-7 text-[#c7b8c2]">Your guests already reach for their phones. Give them something worth pointing one at. Your menu comes alive right at the table, no app to download and no explaining required.</p><div className="mt-8 space-y-4">{['A scan that feels like magic, not homework', 'A better look at what’s actually in the glass', 'The kind of moment guests pass around'].map((line) => <p key={line} className="flex items-center gap-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#493044] text-[#f3a467]"><Check size={13} /></span>{line}</p>)}</div></div>
            <div className="relative min-h-[370px] overflow-hidden rounded-[2.5rem] border border-white/10 bg-[radial-gradient(ellipse_at_45%_48%,#8c405c_0%,#41283f_42%,#241a27_76%)] p-8">
              <div className="absolute left-10 top-10 h-48 w-48 rounded-full bg-[#ec8d53]/10 blur-3xl" />
              <div className="relative mx-auto mt-7 max-w-[300px] rotate-[-5deg] rounded-[2rem] border border-white/20 bg-[#312636] p-3 shadow-2xl">
                <div className="grid h-[270px] place-items-center rounded-[1.5rem] bg-[linear-gradient(150deg,#d66c5b,#6c345b_60%,#312438)]">
                  <div className="flex h-40 w-28 items-center justify-center rounded-b-[2.5rem] rounded-t-lg border border-white/40 bg-gradient-to-b from-[#ffe1a1]/70 via-[#e99a5a]/70 to-[#b64962]/90 shadow-2xl"><span className="h-14 w-14 rounded-full border-[9px] border-[#f5cf79]" /></div>
                  <span className="absolute bottom-4 rounded-full bg-[#241a27]/70 px-4 py-2 text-[10px] text-white">Hold your camera here</span>
                </div>
              </div>
              <span className="absolute bottom-8 right-8 flex items-center gap-2 rounded-full border border-white/15 bg-[#241a27]/60 px-4 py-2 text-xs"><ScanLine size={14} className="text-[#f4a76c]" /> No app download</span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 md:py-32">
          <div className="grid gap-12 md:grid-cols-[.7fr_1.3fr]">
            <div><p className="mb-4 text-[11px] font-bold uppercase tracking-[.22em] text-primary">03 / Built for the shift</p><h2 className="serif text-5xl leading-[1.02] sm:text-6xl">Less fiddling.<br /><em>More flowing.</em></h2></div>
            <div className="grid gap-8 sm:grid-cols-3">
              <div><WandSparkles className="mb-5 text-primary" size={22} /><h3 className="font-semibold">Your menu, your call</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Change a price, 86 a special, put it right back. No designer on speed dial.</p></div>
              <div><TrendingUp className="mb-5 text-primary" size={22} /><h3 className="font-semibold">See what gets a look</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Know which drinks guests stop for, before the next round is on the house.</p></div>
              <div><Camera className="mb-5 text-primary" size={22} /><h3 className="font-semibold">Made to be shared</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">When something looks this good, the group chat takes it from here.</p></div>
            </div>
          </div>
        </section>

        <section id="stories" className="border-y border-border bg-card px-5 py-20 sm:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[.7fr_1.3fr] md:items-end">
            <div><p className="mb-4 text-[11px] font-bold uppercase tracking-[.22em] text-primary">04 / Notes from the bar</p><h2 className="serif text-5xl leading-tight">Good nights<br />make good stories.</h2></div>
            {/* TODO: Replace this clearly labeled placeholder testimonial with a verified independent bar quote. */}
            <blockquote className="border-l-2 border-primary pl-6 sm:pl-9"><p className="serif text-3xl leading-snug sm:text-4xl">“We made the menu feel like part of the night, not a thing guests had to get through.”</p><footer className="mt-6 text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">Placeholder quote · Garnish early-access bar</footer></blockquote>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-24 sm:px-8 md:grid-cols-[1fr_1fr] md:items-center md:py-32">
          <div><p className="mb-4 text-[11px] font-bold uppercase tracking-[.22em] text-primary">05 / The little things add up</p><h2 className="serif text-5xl leading-[1.02] sm:text-6xl">Let the drinks<br />do the <em>talking.</em></h2><p className="mt-6 max-w-md leading-7 text-muted-foreground">Better discovery starts with a better look. A guest who notices your house amaro is a guest who might order it twice.</p><Link href="/login" className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground">Give your menu a lift <MoveUpRight size={16} /></Link></div>
          <div className="grid grid-cols-[1.1fr_.9fr] gap-3">
            <div className="last-call flex min-h-[220px] flex-col justify-between rounded-[2rem] p-6 text-[#271722]"><span className="text-[10px] font-bold uppercase tracking-[.2em]">The bar, in focus</span><span><span className="serif text-5xl">Your<br />signature.</span><span className="mt-4 block text-xs">A reason to come back.</span></span></div>
            <div className="mt-9 flex min-h-[220px] flex-col justify-between rounded-[2rem] bg-secondary p-6 text-secondary-foreground"><ScanLine size={20} /><span><span className="serif text-3xl">Look closer.</span><span className="mt-2 block text-xs opacity-70">The next round starts here.</span></span></div>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-8">
          <div className="last-call relative mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] px-6 py-16 text-center text-[#291721] sm:px-12 sm:py-20">
            <span className="absolute -right-12 -top-24 h-64 w-64 rounded-full border border-[#35202b]/15" /><span className="absolute -bottom-36 -left-10 h-72 w-72 rounded-full border border-[#35202b]/15" />
            <p className="relative mb-5 text-[11px] font-bold uppercase tracking-[.22em]">Your next great menu is already in the making</p>
            <h2 className="serif relative mx-auto max-w-3xl text-5xl leading-[1.02] sm:text-7xl">Give them a reason to look twice.</h2>
            <Link href="/login" className="relative mx-auto mt-8 flex min-h-14 w-fit items-center gap-3 rounded-2xl bg-[#2b1d2a] px-6 font-semibold text-[#f7e9d9]">Try it free for 30 days <ArrowRight size={17} /></Link>
            <p className="relative mt-4 text-xs text-[#422432]/75">No card on the table. Start with 30 days on us.</p>
          </div>
        </section>
      </main>
      <footer className="border-t border-border px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark /><p className="text-xs text-muted-foreground">For the people who make the night.</p><div className="flex gap-5 text-xs text-muted-foreground"><a href="#how-it-works" className="min-h-11 content-center">How it works</a><Link href="/login" className="min-h-11 content-center">Sign in <ChevronRight size={12} className="inline" /></Link></div>
        </div>
      </footer>
    </div>
  );
}
