"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ChatComposer } from "@/components/ChatComposer";
import { createSession, setAutostart } from "@/lib/chat-sessions";
import { startProgress } from "@/lib/route-progress";

const EXAMPLE_PROMPTS = [
  "Dashboard de NBA com top scorers",
  "Quero ver o gap entre escolas",
  "Painel de avaliações BNCC",
];

// Home entry point: typing a prompt creates a session and routes to /c/{id},
// where the conversation auto-starts — the URL changes immediately.

export function HomeLauncher() {
  const router = useRouter();
  const [input, setInput] = useState("");

  function launch(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    const session = createSession({ title: prompt, mode: "create" });
    setAutostart(session.id, prompt);
    startProgress();
    router.push(`/c/${session.id}`);
  }

  return (
    <Card className="max-w-3xl mx-auto p-6 flex flex-col gap-4 w-full">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Criar um novo dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Conte o que você quer analisar e a IA vai buscar os dados, criar os
          gráficos e montar o painel automaticamente.
        </p>
      </div>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={launch}
        onStop={() => {}}
        streaming={false}
        minRows={3}
        placeholder="Ex: Quero um dashboard com as notas médias por escola e a taxa de presença"
      />

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground font-medium">Exemplos:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              className="text-xs px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => launch(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
