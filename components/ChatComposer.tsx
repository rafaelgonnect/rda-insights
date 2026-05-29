"use client";
import { useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square } from "lucide-react";

// Shared chat input: auto-growing textarea + send/stop button.
// Enter submits; Shift+Enter inserts a newline.

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  placeholder = "Escreva uma mensagem…",
  autoFocus = false,
  minRows = 1,
  maxHeight = 200,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  minRows?: number;
  maxHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }

  function reset() {
    if (ref.current) ref.current.style.height = "auto";
  }

  function fire() {
    const text = value.trim();
    if (!text || streaming) return;
    onSubmit(text);
    reset();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fire();
    }
  }

  return (
    <div className={`flex gap-2 items-end ${className}`}>
      <textarea
        ref={ref}
        rows={minRows}
        autoFocus={autoFocus}
        className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 min-h-[2.25rem]"
        placeholder={placeholder}
        value={value}
        disabled={streaming}
        onChange={(e) => {
          onChange(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={handleKeyDown}
      />
      {streaming ? (
        <Button size="icon-sm" variant="outline" onClick={onStop} title="Parar">
          <Square className="size-3.5" />
        </Button>
      ) : (
        <Button
          size="icon-sm"
          disabled={!value.trim()}
          onClick={fire}
          title="Enviar (Enter)"
        >
          <Send className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
