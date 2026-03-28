import { useEffect, useRef } from "react";
import { renderMarkdown } from "../lib/markdown";

interface ChatMessageProps {
  content: string;
  role: "user" | "assistant" | "system";
  timestamp?: string;
}

export function ChatMessage({ content, role, timestamp }: ChatMessageProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>(".code-copy-btn");
    const handlers: Array<{ btn: HTMLButtonElement; handler: () => void }> = [];

    buttons.forEach((btn) => {
      const handler = () => {
        const encoded = btn.getAttribute("data-code");
        if (!encoded) return;
        const code = decodeURIComponent(encoded);
        navigator.clipboard.writeText(code).then(() => {
          const original = btn.textContent;
          btn.textContent = "Copiado!";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove("copied");
          }, 1500);
        });
      };
      btn.addEventListener("click", handler);
      handlers.push({ btn, handler });
    });

    return () => {
      handlers.forEach(({ btn, handler }) => {
        btn.removeEventListener("click", handler);
      });
    };
  }, [content]);

  const html = renderMarkdown(content);

  return (
    <div
      ref={containerRef}
      className={`message-content max-w-[94%] space-y-1 rounded-[18px] px-3 py-2 ${
        role === "user"
          ? "ml-auto bg-[#d9fdd3] text-black shadow-[0_1px_1px_rgba(0,0,0,0.08)]"
          : "bg-white text-black shadow-[0_1px_1px_rgba(0,0,0,0.08)]"
      }`}
    >
      {timestamp && (
        <div
          className={`flex items-center justify-between gap-3 text-[11px] ${
            role === "user" ? "text-[#4f5f5a]" : "text-[#667781]"
          }`}
        >
          <span className="font-medium">{role === "user" ? "voce" : role}</span>
          <span>{timestamp}</span>
        </div>
      )}
      <div
        className="break-words text-[15px] leading-7 [overflow-wrap:anywhere]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
