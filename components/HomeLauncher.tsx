"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ChatComposer } from "@/components/ChatComposer";
import {
  createSession,
  setAutostart,
  type ChatSessionMode,
} from "@/lib/chat-sessions";
import { startProgress } from "@/lib/route-progress";

const EXAMPLES: Record<ChatSessionMode, string[]> = {
  chat: [
    "O que esses dados me dizem sobre o gap entre escolas?",
    "Quais perguntas eu poderia responder com o dataset de avaliações?",
    "Me ajude a planejar um painel sobre BNCC",
  ],
  dev: [
    "Dashboard de NBA com top scorers",
    "Crie um painel de avaliações BNCC",
    "Adicione um gráfico de presença por escola",
  ],
};

// Home entry point: pick a mode, type a prompt → creates a session and routes
// to /c/{id}, where the conversation auto-starts.

export function HomeLauncher() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatSessionMode>("chat");

  function launch(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    const session = createSession({ title: prompt, mode });
    setAutostart(session.id, prompt);
    startProgress();
    router.push(`/c/${session.id}`);
  }

  return (
    <Card className="max-w-3xl mx-auto p-6 flex flex-col gap-4 w-full">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {mode === "dev" ? "Construir com a IA" : "Conversar com seus dados"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {mode === "dev"
            ? "Descreva o painel ou a mudança que você quer — a IA busca os dados, propõe e aplica (com sua confirmação)."
            : "Planeje, tire dúvidas e faça brainstorming em cima dos dados reais do Superset. Quando quiser construir, troque para o modo Dev."}
        </p>
      </div>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={launch}
        onStop={() => {}}
        streaming={false}
        minRows={3}
        mode={mode}
        onModeChange={setMode}
        placeholder={
          mode === "dev"
            ? "Ex: Quero um dashboard com as notas médias por escola e a taxa de presença"
            : "Ex: Onde estão os maiores gaps de desempenho nesses dados?"
        }
      />

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground font-medium">Exemplos:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES[mode].map((prompt) => (
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
