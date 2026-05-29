import { SettingsClient } from "./SettingsClient";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const initial = await getSettings();
  return (
    <div className="p-6 max-w-2xl mx-auto h-full overflow-y-auto">
      <h1 className="text-2xl font-semibold mb-1">Configurações</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Valores persistidos no Redis. Aplicam imediatamente, sem redeploy.
      </p>
      <SettingsClient initial={initial} />
    </div>
  );
}
