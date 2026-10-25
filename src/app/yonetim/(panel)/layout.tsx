import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { Wordmark } from "@/components/brand/Logo";
import { requireAdmin } from "@/server/auth/current";
import { adminSignOutAction } from "./actions";

/**
 * Panel çerçevesi. Buradaki kontrol yalnızca ilk savunma: her sayfa ve her Server Action ayrıca
 * kendi içinde requireAdmin() çağırır.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-svh lg:flex">
      <a
        href="#icerik"
        className="label sr-only z-[60] bg-ink px-4 py-3 text-paper focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        İçeriğe geç
      </a>
      <aside className="sticky top-0 z-30 border-b border-rule bg-paper lg:flex lg:h-svh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex h-14 items-center gap-3 px-4 lg:h-20 lg:px-6">
          <Link href="/yonetim" className="flex min-h-11 items-center gap-3" aria-label="Yönetim panosu">
            <Wordmark className="h-[11px] w-auto" />
          </Link>
          <span className="label text-graphite">Yönetim</span>
          <form action={adminSignOutAction} className="ml-auto lg:hidden">
            <button type="submit" className="label min-h-11 px-1 text-graphite hover:text-ink">
              Çıkış
            </button>
          </form>
        </div>
        <div className="pb-1 lg:flex-1 lg:overflow-y-auto lg:pb-0">
          <AdminNav />
        </div>
        <div className="hidden border-t border-rule px-6 py-4 lg:block">
          <Link
            href="/"
            target="_blank"
            rel="noopener"
            className="label flex min-h-11 items-center text-graphite hover:text-ink"
          >
            Vitrini aç <span aria-hidden="true">&nbsp;↗</span>
          </Link>
          <p className="mt-2 truncate text-[0.75rem] text-graphite" title={admin.email}>
            {admin.email}
          </p>
          <form action={adminSignOutAction}>
            <button type="submit" className="label flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
              Çıkış yap
            </button>
          </form>
        </div>
      </aside>
      <main id="icerik" className="min-w-0 flex-1 px-4 pt-6 pb-16 md:px-8 lg:px-12 lg:pt-12">
        {children}
        <p className="mt-16 lg:hidden">
          <Link href="/" target="_blank" rel="noopener" className="label inline-flex min-h-11 items-center text-graphite">
            Vitrini aç <span aria-hidden="true">&nbsp;↗</span>
          </Link>
        </p>
      </main>
    </div>
  );
}
