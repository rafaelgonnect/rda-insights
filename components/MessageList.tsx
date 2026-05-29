"use client";
import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessageItem, type ChatMessageType } from "@/components/ChatMessage";

// Renders the message thread: messages + inline error + auto-scroll anchor.
// Copy / regenerate actions are surfaced on the last assistant message.

export function MessageList({
  messages,
  streaming,
  error,
  clearError,
  onConfirm,
  onRegenerate,
  className = "",
}: {
  messages: ChatMessageType[];
  streaming: boolean;
  error?: string | null;
  clearError?: () => void;
  onConfirm?: (pendingId: string, decision: "apply" | "cancel") => void;
  onRegenerate?: () => void;
  className?: string;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Index of the last assistant message (gets copy/regenerate actions).
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  return (
    <div className={className}>
      {messages.map((msg, idx) => {
        const isLastAssistant = idx === lastAssistantIdx;
        const assistantHasContent =
          msg.role === "assistant" && msg.content.trim().length > 0;
        return (
          <ChatMessageItem
            key={
              msg.role === "tool_activity"
                ? msg.toolCallId
                : msg.role === "tool_confirmation"
                ? msg.id
                : (msg as { id: string }).id
            }
            msg={msg}
            onConfirm={onConfirm}
            globalStreaming={streaming && idx === messages.length - 1}
            showActions={isLastAssistant && !streaming && assistantHasContent}
            onRegenerate={onRegenerate}
          />
        );
      })}

      {error && (
        <div className="mb-3 p-3 rounded-lg border border-destructive/40 bg-destructive/5 flex gap-2 items-start">
          <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-destructive break-words">{error}</p>
            {clearError && (
              <Button size="sm" variant="ghost" className="mt-2 h-7" onClick={clearError}>
                Fechar
              </Button>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
