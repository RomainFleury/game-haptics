import { useState, type MouseEvent } from "react";

type CopyUrlButtonProps = {
  label: string;
  url: string;
  className?: string;
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Copies a URL on left-click or right-click instead of opening it in-app
 * (Nexus login inside Electron is painful).
 */
export function CopyUrlButton({ label, url, className }: CopyUrlButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => void handleCopy(e)}
      onContextMenu={(e) => void handleCopy(e)}
      title={`Click or right-click to copy URL:\n${url}`}
      className={
        className ||
        "inline-flex items-center gap-1.5 rounded-lg bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-white/10 transition hover:bg-slate-600 hover:text-sky-200"
      }
    >
      <svg className="h-3.5 w-3.5 opacity-80 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
      {copied ? "Copied!" : label}
    </button>
  );
}
