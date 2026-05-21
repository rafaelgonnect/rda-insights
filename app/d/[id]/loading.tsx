import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <AppShell>
      <div className="flex h-full">
        {/* Main iframe area */}
        <div className="flex-1 p-4">
          <Skeleton className="w-full h-full min-h-[400px]" />
        </div>

        {/* ChatSidebar skeleton */}
        <aside className="w-96 border-l flex flex-col h-full">
          {/* Header */}
          <div className="p-3 border-b shrink-0 flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>

          {/* Message list */}
          <div className="flex-1 p-3 space-y-3 overflow-hidden">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-12 w-3/4 ml-auto rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-10 w-2/3 rounded-lg" />
            <Skeleton className="h-16 w-5/6 ml-auto rounded-lg" />
          </div>

          {/* Footer input */}
          <div className="p-3 border-t shrink-0">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
