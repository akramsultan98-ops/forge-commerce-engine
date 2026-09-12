import Link from "next/link";

export default function NotFound() {
  return (
    <main className="store grid min-h-screen place-items-center bg-paper px-5 text-ink [color-scheme:light]">
      <div className="max-w-lg text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">404</p>
        <h1 className="mt-4 font-display text-6xl leading-none">Nothing here.</h1>
        <p className="mt-5 text-muted">The page moved, or never existed. The products are still where you left them.</p>
        <Link href="/products" className="mt-8 inline-flex h-12 items-center rounded-full bg-ink px-7 text-[15px] text-paper hover:opacity-85">
          Explore products
        </Link>
      </div>
    </main>
  );
}
