// Shown in the main content area during route transitions. The sidebar lives
// in the root layout and stays put, so this only fills <main>.
export default function Loading() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="size-6 rounded-full border-2 border-muted border-t-foreground animate-spin" />
    </div>
  );
}
