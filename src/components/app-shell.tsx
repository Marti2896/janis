"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FilePlus2,
  FileText,
  Inbox,
  KeyRound,
  LogOut,
  Menu,
  Network,
  ScrollText,
  ShieldCheck,
  Settings2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { logoutAction } from "@/app/login/actions";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  admin?: boolean;
}

const NAV: NavItem[] = [
  { href: "/fatture", label: "Fatture emesse", icon: FileText },
  { href: "/ricevute", label: "Fatture ricevute", icon: Inbox },
  { href: "/fatture/nuova", label: "Nuova fattura", icon: FilePlus2 },
  { href: "/stato", label: "Stato canale", icon: Activity },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/api", label: "API", icon: KeyRound },
  { href: "/certificati", label: "Certificati", icon: ShieldCheck, admin: true },
  { href: "/admin/account", label: "Account", icon: Users, admin: true },
  { href: "/admin/canale", label: "Canale", icon: Settings2, admin: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/fatture") {
    return pathname === "/fatture" || (pathname.startsWith("/fatture/") && pathname !== "/fatture/nuova");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  user,
  children,
}: {
  user: { email: string; role: "admin" | "cliente" } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (!user) return <>{children}</>;

  const items = NAV.filter((i) => !i.admin || user.role === "admin");
  const roleLabel = user.role === "admin" ? "Amministratore" : "Cliente";

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Apri il menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Network className="size-5" />
                  Interscambio
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-2" aria-label="Navigazione principale">
                {items.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                        isActive(pathname, item.href) && "bg-accent font-medium",
                      )}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>

          <Link href="/fatture" className="flex items-center gap-2 font-semibold">
            <Network className="size-5" />
            Interscambio
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Navigazione principale">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  isActive(pathname, item.href) && "bg-accent font-medium text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto md:ml-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Menu utente">
                  <User />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex flex-col gap-1">
                  <span className="truncate">{user.email}</span>
                  <Badge variant="secondary" className="w-fit">
                    {roleLabel}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <form action={logoutAction}>
                  <DropdownMenuItem asChild>
                    <button type="submit" className="w-full cursor-default">
                      <LogOut />
                      Esci
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <Separator className="md:hidden" />
      </header>
      <div className="flex min-w-0 flex-1 flex-col [&>main]:w-full [&>main]:min-w-0">{children}</div>
      <Toaster />
    </>
  );
}
