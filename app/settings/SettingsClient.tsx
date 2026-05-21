"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const COMMON_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-opus-4.1",
  "anthropic/claude-3.5-haiku",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
];

type Settings = { model: string; maxTokens: number; maxUsdMonth: number };

export function SettingsClient({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          maxTokens: settings.maxTokens,
          maxUsdMonth: settings.maxUsdMonth,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const updated = (await res.json()) as Settings;
      setSettings(updated);
      setMsg({ type: "ok", text: "Salvo." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="p-4 space-y-4">
        <div>
          <label htmlFor="model" className="text-sm font-medium block mb-1">
            Modelo (slug OpenRouter)
          </label>
          <input
            id="model"
            list="common-models"
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="anthropic/claude-sonnet-4.5"
            required
            autoComplete="off"
          />
          <datalist id="common-models">
            {COMMON_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground mt-1">
            Lista completa em{" "}
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              openrouter.ai/models
            </a>
            . Trocar de modelo invalida o cache automaticamente.
          </p>
        </div>

        <div>
          <label htmlFor="maxTokens" className="text-sm font-medium block mb-1">
            Max tokens por insight
          </label>
          <input
            id="maxTokens"
            type="number"
            min={50}
            max={4000}
            value={settings.maxTokens}
            onChange={(e) =>
              setSettings({ ...settings, maxTokens: Number(e.target.value) })
            }
            className="w-full border rounded px-2 py-1 text-sm"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Quanto maior, insight mais longo e mais caro. Default: 600.
          </p>
        </div>

        <div>
          <label htmlFor="maxUsdMonth" className="text-sm font-medium block mb-1">
            Cost cap mensal (USD)
          </label>
          <input
            id="maxUsdMonth"
            type="number"
            min={0.01}
            step={0.01}
            value={settings.maxUsdMonth}
            onChange={(e) =>
              setSettings({ ...settings, maxUsdMonth: Number(e.target.value) })
            }
            className="w-full border rounded px-2 py-1 text-sm"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Quando o gasto estimado do mês passar disso, requests retornam 429.
            Spend real em{" "}
            <a
              href="https://openrouter.ai/activity"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              openrouter.ai/activity
            </a>
            .
          </p>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
        {msg && (
          <span
            className={
              msg.type === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"
            }
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
