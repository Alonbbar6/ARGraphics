import { Link } from 'wouter';
import { BrandMark } from '@/components/brand';
import '@/components/partner.css';

/**
 * Pilot-grade privacy policy and terms: short, plain, and honest about what the service
 * does today. Review with a lawyer before charging anyone or leaving the pilot.
 */

const UPDATED = 'October 19, 2026';
const CONTACT = 'hello@argraphics.app';

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] px-4 pb-20 pt-6 text-white">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="ARGraphics home">
            <BrandMark size={28} />
            <span className="text-sm font-semibold">ARGraphics</span>
          </Link>
          <Link href="/" className="text-sm text-white/60 hover:text-white">Back to home</Link>
        </header>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-white/50">Last updated {UPDATED}</p>
        <div className="legal-body mt-8 space-y-6 text-[15px] leading-7 text-white/80">{children}</div>
      </div>
    </main>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-lg font-semibold text-white">{children}</h2>;
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy">
      <p>ARGraphics helps food trucks, stands, bars, restaurants and local artists show 3D menu items, offers and art to people at their spot. This page explains what we collect and why, in plain language.</p>

      <H2>If you scan a code or open a venue page</H2>
      <p>You do not need an account. We store an anonymous visitor ID in your browser (or in the ARGraphics iPhone app) so the venue can count unique visitors and limit how many times one offer can be claimed. It is a random string; it does not identify you. We record which code was scanned, when, and which offers were claimed. We do not collect your name, location, contacts or photos, and we do not use advertising trackers.</p>
      <p>AR runs on your phone. Camera images never leave your device.</p>

      <H2>If you run a venue, truck, stand or you are an artist</H2>
      <p>We store the details you give us: your name, email address, business name, neighborhood and address, and what you upload: photos, 3D models, artwork, offers and events. Photos you upload to make a 3D model are processed by our 3D generation provider (Meshy) for that purpose only. Your password is stored as a one-way hash.</p>
      <p>We use your email to sign you in, to reset your password when you ask, and to tell you about your account. We do not sell your information or share it with advertisers.</p>

      <H2>Who else sees data</H2>
      <p>Our hosting provider (Railway) runs the servers and database. Our 3D generation provider receives the item photos you choose to turn into 3D. Nobody else receives your data unless the law requires it.</p>

      <H2>How long we keep it</H2>
      <p>Scan and claim records stay for as long as the venue keeps its account, so its analytics keep working. Partners can delete items, displays, codes and artwork at any time, and can ask us to delete their whole account by emailing {CONTACT}.</p>

      <H2>Your choices</H2>
      <p>Clearing your browser storage removes your visitor ID. Partners can edit or delete their information in the dashboard. Questions or requests: <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>.</p>

      <H2>Changes</H2>
      <p>If we change this page, we update the date at the top. During the pilot we may add features; we will say so here before they collect anything new.</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of use">
      <p>These terms cover the ARGraphics website, dashboard, guest pages and iPhone app during our pilot. By creating an account or using the service you agree to them.</p>

      <H2>The pilot</H2>
      <p>ARGraphics is in a pilot. Founding partners use Business features for free until the date shown on their Plan page. We may change features, pause the service for maintenance, or end the pilot with notice.</p>

      <H2>Payments</H2>
      <p>Browsing is free. Paid things are listed on your Plan page before you buy them. Payments are handled by Stripe; we never see your card number. The Business plan is billed monthly in advance and renews until you cancel, which you can do at any time from the billing portal; features stay on until the end of the period you paid for. Build credits cost $5 each, do not expire, and are not refundable, except that a credit is returned automatically when a build fails to start, fails, or is rejected by our quality check. Exclusivity means we will not promote another business in your category in your neighborhood while your plan is active; it does not stop anyone from using ARGraphics.</p>

      <H2>Your account</H2>
      <p>You are responsible for keeping your password safe and for what is published under your account. One account per business. You must be allowed to speak for the business you register.</p>

      <H2>What you publish</H2>
      <p>You keep ownership of your photos, menu items, offers and artwork. You give us permission to store them, turn photos into 3D models, and show them to people who scan your codes or open your pages. Only publish things you have the right to publish: your own food and drinks, offers you will honour, and art you own or have licensed. Artists keep ownership of their work; a licence to a venue lasts as long as both agree in the dashboard.</p>

      <H2>Offers</H2>
      <p>An offer a customer claims through ARGraphics is between you and that customer. You decide the terms and you honour them. We only count and display them.</p>

      <H2>Fair use</H2>
      <p>Do not use the service to publish anything illegal, misleading, hateful or infringing, or to interfere with the service or other partners. We can remove content or suspend accounts that break this.</p>

      <H2>No guarantees</H2>
      <p>The service is provided as is during the pilot. We work hard to keep it up and accurate, but we do not promise uninterrupted service, exact counts, or any particular business result. To the extent the law allows, our liability is limited to the amount you have paid us in the three months before the claim.</p>

      <H2>Contact</H2>
      <p>Questions about these terms: <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>.</p>
    </LegalLayout>
  );
}
