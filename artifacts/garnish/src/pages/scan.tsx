import { useEffect } from 'react';
import { Apple, Smartphone } from 'lucide-react';
import { BrandMark } from '@/components/shell';
import '@/components/partner.css';

// TODO: replace with the real App Store listing once the ARGraphics iOS app is published.
export const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000';

/**
 * Public landing for /s/:code. With the ARGraphics app installed, iOS opens the app
 * directly (universal link); this page is for guests who don't have it yet.
 */
export function ScanFallbackPage({ code }: { code: string }) {
  const safeCode = /^[a-z0-9]{6,16}$/.test(code) ? code : '';
  const appLink = safeCode ? `argraphics://s/${safeCode}` : 'argraphics://';

  useEffect(() => {
    const previous = document.title;
    document.title = 'Open in ARGraphics';
    return () => { document.title = previous; };
  }, []);

  return (
    <main className="dark relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#0B0B14] px-4 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_10%,rgba(109,40,217,.55),transparent_55%),radial-gradient(ellipse_at_15%_95%,rgba(244,63,94,.35),transparent_50%)]" aria-hidden="true" />
      <div className="relative w-full max-w-sm text-center">
        <div className="mx-auto mb-8 flex items-center justify-center gap-2.5">
          <BrandMark size={34} />
          <span className="text-base font-bold">ARGraphics</span>
        </div>
        <div className="relative mx-auto mb-8 grid h-36 w-36 place-items-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-[2rem] border-2 border-[#A855F7]/70" />
          <span className="absolute inset-5 rounded-full bg-[radial-gradient(circle,#FDE68A_0%,#FB923C_22%,#F43F5E_45%,#6D28D9_75%,transparent_76%)] blur-[1px]" />
          <span className="pa-anchor relative h-3 w-3 rounded-full bg-[#F43F5E]" />
        </div>
        <h1 className="serif text-[2.4rem] leading-[1.08]">This spot has something you can only see in the room.</h1>
        <p className="mt-4 text-sm leading-6 text-white/80">Open it in the ARGraphics app, point your phone where the code is, and look up. Offers, art and specials live right here.</p>
        <div className="mt-8 flex flex-col gap-3">
          <a href={appLink} className="pa-btn pa-btn-primary w-full" data-testid="link-open-app"><Smartphone size={18} aria-hidden="true" /> Open in the ARGraphics app</a>
          <a href={APP_STORE_URL} className="pa-btn w-full border-white/25 bg-white/5 text-white hover:bg-white/10" data-testid="link-app-store"><Apple size={18} aria-hidden="true" /> Get the app on the App Store</a>
        </div>
        <p className="mt-6 text-xs text-white/65">Already installed it? Scan the code again with your iPhone camera.</p>
        {safeCode && <p className="mt-2 font-mono text-[11px] tracking-wider text-white/50">Spot code {safeCode}</p>}
      </div>
    </main>
  );
}
