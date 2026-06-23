"use client";
import { useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square, MessageCircle, Wrench } from "lucide-react";

export type ComposerMode = "chat" | "dev";

// Shared chat input: optional mode toggle + auto-growing textarea + send/stop.
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
  mode,
  onModeChange,
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
  /** When both are provided, a Bate-papo/Dev segmented toggle is shown. */
  mode?: ComposerMode;
  onModeChange?: (m: ComposerMode) => void;
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

  const showToggle = mode !== undefined && onModeChange !== undefined;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {showToggle && (
        <div className="flex items-center gap-1 self-start rounded-lg border bg-muted/40 p-0.5 text-xs">
          <ModeButton
            active={mode === "chat"}
            onClick={() => onModeChange!("chat")}
            icon={<MessageCircle className="size-3.5" />}
            label="Bate-papo"
            title="Planejar, tirar dúvidas e fazer brainstorming sobre os dados (somente leitura)"
          />
          <ModeButton
            active={mode === "dev"}
            onClick={() => onModeChange!("dev")}
            icon={<Wrench className="size-3.5" />}
            label="Dev"
            title="Criar e alterar dashboards e gráficos (cada mudança pede confirmação)"
          />
        </div>
      )}
      <div className="flex gap-2 items-end">
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
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
