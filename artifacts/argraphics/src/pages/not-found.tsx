import { Link } from 'wouter';
import { Wordmark } from '@/components/shell';
import { buttonClass } from '@/components/partner-ui';

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center"><Wordmark /></div>
        <h1 className="serif text-5xl leading-tight">Wrong table.</h1>
        <p className="mt-3 text-sm text-muted-foreground">That page isn’t here. It may have moved, or the link was mistyped.</p>
        <Link href="/home" className={buttonClass('primary', 'md', 'mt-8')}>Back to your dashboard</Link>
      </div>
    </main>
  );
}
