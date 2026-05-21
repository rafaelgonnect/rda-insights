import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto flex flex-col gap-8">
        {/* HomeChat skeleton */}
        <div className="max-w-3xl mx-auto w-full py-2">
          <Card className="max-w-3xl mx-auto p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full mt-1" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <Skeleton className="h-20 w-full rounded-lg" />
            <div className="flex gap-2 flex-wrap">
              <Skeleton className="h-7 w-28 rounded-full" />
              <Skeleton className="h-7 w-36 rounded-full" />
              <Skeleton className="h-7 w-32 rounded-full" />
            </div>
          </Card>
        </div>

        {/* Dashboard grid skeleton */}
        <div>
          <Skeleton className="h-7 w-36 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
