import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col gap-6 px-6 py-10 lg:px-10" aria-busy="true">
      <Skeleton className="h-9 w-56" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </main>
  );
}
