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
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Fatture",
    items: [
      { href: "/fatture", label: "Fatture emesse", icon: FileText },
      { href: "/ricevute", label: "Fatture ricevute", icon: Inbox },
      { href: "/fatture/nuova", label: "Nuova fattura", icon: FilePlus2 },
    ],
  },
  {
    label: "Canale",
    items: [
      { href: "/stato", label: "Stato canale", icon: Activity },
      { href: "/api", label: "API e chiavi", icon: KeyRound },
    ],
  },
  {
    label: "Audit",
    items: [{ href: "/audit", label: "Cronologia attività", icon: ScrollText }],
  },
];

const ADMIN_GROUP: NavGroup = {
  label: "Amministrazione",
  items: [
    { href: "/admin/account", label: "Account clienti", icon: Users },
    { href: "/admin/canale", label: "Configurazione SdI", icon: Settings2 },
    { href: "/certificati", label: "Certificati", icon: ShieldCheck },
  ],
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/fatture") {
    return pathname === "/fatture" || (pathname.startsWith("/fatture/") && pathname !== "/fatture/nuova");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type ShellUser = { email: string; role: "admin" | "cliente"; mustChangePassword?: boolean };

function UserMenu({ user, variant }: { user: ShellUser; variant: "sidebar" | "bar" }) {
  const roleLabel = user.role === "admin" ? "Amministratore" : "Cliente";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-3 py-2" aria-label="Menu utente">
            <User />
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span className="w-full truncate text-sm">{user.email}</span>
              <Badge variant="secondary">{roleLabel}</Badge>
            </span>
          </Button>
        ) : (
          <Button variant="outline" size="icon" aria-label="Menu utente">
            <User />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        className="w-56"
      >
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
  );
}

function SidebarContent({
  user,
  pathname,
  mobile,
}: {
  user: ShellUser;
  pathname: string;
  mobile?: boolean;
}) {
  const groups = user.mustChangePassword ? [] : GROUPS;
  const showAdmin = !user.mustChangePassword && user.role === "admin";

  function renderGroup(group: NavGroup) {
    return (
      <div key={group.label} className="flex flex-col gap-1 pb-4">
        <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {group.label}
        </p>
        {group.items.map((item) => {
          const active = isActive(pathname, item.href);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                active && "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
          return mobile ? (
            <SheetClose asChild key={item.href}>
              {link}
            </SheetClose>
          ) : (
            link
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Link href="/fatture" className="flex h-14 shrink-0 items-center gap-2 px-5 text-base font-semibold tracking-tight">
        <Network className="size-5 text-primary" />
        Interscambio
      </Link>
      <nav aria-label="Navigazione principale" className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map(renderGroup)}
        {showAdmin && (
          <>
            <Separator className="mb-4" />
            {renderGroup(ADMIN_GROUP)}
          </>
        )}
      </nav>
      <div className="border-t p-3">
        <UserMenu user={user} variant="sidebar" />
      </div>
    </div>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: ShellUser | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (!user) return <>{children}</>;

  return (
    <>
      <div className="flex min-h-screen w-full flex-1">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
          <SidebarContent user={user} pathname={pathname} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4 md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Apri il menu">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 gap-0 bg-sidebar p-0">
                <SheetTitle className="sr-only">Menu di navigazione</SheetTitle>
                <SidebarContent user={user} pathname={pathname} mobile />
              </SheetContent>
            </Sheet>
            <Link href="/fatture" className="flex items-center gap-2 font-semibold">
              <Network className="size-5 text-primary" />
              Interscambio
            </Link>
            <div className="ml-auto">
              <UserMenu user={user} variant="bar" />
            </div>
          </header>
          <div className="flex min-w-0 flex-1 flex-col [&>main]:w-full [&>main]:min-w-0">{children}</div>
        </div>
      </div>
      <Toaster />
    </>
  );
}
