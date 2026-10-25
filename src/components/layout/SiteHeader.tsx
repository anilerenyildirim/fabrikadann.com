"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/brand/Logo";

export type HeaderCategory = { name: string; slug: string };

type Props = {
  categories: HeaderCategory[];
  cartCount: number;
  signedIn: boolean;
  announcement?: string;
};

export function SiteHeader({ categories, cartCount, signedIn, announcement }: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // Ana sayfada başlık görselin üstünde şeffaf durur
  const overlay = pathname === "/" && !scrolled && !menuOpen;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <>
      {announcement ? (
        <div className="relative z-40 bg-ink px-4 py-2 text-center text-[0.625rem] leading-[0.875rem] font-[450] tracking-[0.04em] text-balance text-paper uppercase sm:text-[0.75rem] sm:tracking-[0.06em]">
          {announcement}
        </div>
      ) : null}
      <header
        className={`sticky top-0 z-40 transition-colors duration-200 ${
          overlay ? "bg-transparent" : "bg-paper/95 backdrop-blur-sm"
        } ${pathname === "/" ? "-mb-14 md:-mb-16" : ""}`}
      >
        <div className="flex h-14 items-center gap-1 px-2 md:h-16 md:gap-4 md:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            className="label flex min-h-11 min-w-11 items-center justify-center gap-3 md:justify-start md:pr-2"
          >
            <MenuIcon />
            <span className="sr-only md:not-sr-only">Menü</span>
          </button>

          <Link href="/" className="flex min-h-11 items-center px-1" aria-label="fabrikadann ana sayfa">
            <Wordmark className="h-[13px] w-auto md:h-[17px]" />
          </Link>

          <nav className="ml-auto flex items-center" aria-label="Hesap ve sepet">
            <HeaderLink href="/ara" label="Ara" icon={<SearchIcon />} />
            <HeaderLink
              href={signedIn ? "/hesabim" : "/giris"}
              label={signedIn ? "Hesabım" : "Giriş yap"}
              icon={<UserIcon />}
            />
            <Link
              href="/sepet"
              className="label flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-1 md:px-2"
              aria-label={`Sepet, ${cartCount} ürün`}
            >
              <BagIcon />
              <span className="hidden md:inline">Sepet</span>
              <span className="tabular" aria-hidden="true">
                {cartCount}
              </span>
            </Link>
          </nav>
        </div>
      </header>
      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} categories={categories} signedIn={signedIn} />
    </>
  );
}

function HeaderLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="label flex min-h-11 min-w-11 items-center justify-center px-1 md:px-2">
      <span className="md:hidden" aria-hidden="true">
        {icon}
      </span>
      <span className="sr-only md:not-sr-only">{label}</span>
    </Link>
  );
}

function MenuDrawer({
  open,
  onClose,
  categories,
  signedIn,
}: {
  open: boolean;
  onClose: () => void;
  categories: HeaderCategory[];
  signedIn: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div
      id="site-menu"
      className={`fixed inset-0 z-50 ${open ? "visible" : "invisible"}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className={`absolute inset-0 bg-ink/20 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menü"
        className={`absolute inset-y-0 left-0 flex w-full flex-col bg-paper transition-transform duration-300 ease-(--ease-cut) sm:w-[26rem] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center px-2 md:h-16 md:px-6">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="label flex min-h-11 min-w-11 items-center gap-3"
          >
            <CloseIcon />
            <span className="sr-only md:not-sr-only">Kapat</span>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-6 pb-10 pt-6 md:px-10" aria-label="Kategoriler">
          <ul className="space-y-1">
            <li>
              <MenuLink href="/urunler" big>
                Tüm ürünler
              </MenuLink>
            </li>
            {categories.map((c) => (
              <li key={c.slug}>
                <MenuLink href={`/kategori/${c.slug}`} big>
                  {c.name}
                </MenuLink>
              </li>
            ))}
          </ul>
          <ul className="mt-12 space-y-0.5 border-t border-rule pt-6">
            <li>
              <MenuLink href={signedIn ? "/hesabim" : "/giris"}>{signedIn ? "Hesabım" : "Giriş yap"}</MenuLink>
            </li>
            <li>
              <MenuLink href="/hesabim/siparisler">Siparişlerim</MenuLink>
            </li>
            <li>
              <MenuLink href="/iade-degisim">İade ve değişim</MenuLink>
            </li>
            <li>
              <MenuLink href="/sss">Sık sorulan sorular</MenuLink>
            </li>
            <li>
              <MenuLink href="/iletisim">İletişim</MenuLink>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}

function MenuLink({ href, children, big = false }: { href: string; children: React.ReactNode; big?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center hover:underline hover:underline-offset-4 ${
        big ? "wide text-[0.9375rem] font-[350]" : "label text-graphite"
      }`}
    >
      {children}
    </Link>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  className: "size-[22px]",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.2,
  "aria-hidden": true,
} as const;

function MenuIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 8.5h18M3 15.5h18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg {...iconProps} className="size-[22px] md:hidden">
      <path d="M5 8h14l-1 13H6L5 8z" />
      <path d="M9 8V6a3 3 0 016 0v2" />
    </svg>
  );
}
