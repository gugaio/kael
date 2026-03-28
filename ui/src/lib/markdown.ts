import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";

const renderer = new marked.Renderer();

renderer.code = function (token: Tokens.Code): string {
  const text = token.text;
  const lang = token.lang ?? "";
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  const langLabel = lang || "code";
  return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${langLabel}</span><button class="code-copy-btn" data-code="${encodeURIComponent(text)}">Copiar</button></div><pre class="code-block"><code class="hljs language-${language}">${highlighted}</code></pre></div>`;
};

renderer.heading = function (token: Tokens.Heading): string {
  const text = this.parser.parseInline(token.tokens);
  const sizes: Record<number, string> = {
    1: "text-xl font-bold mt-4 mb-2",
    2: "text-lg font-bold mt-3 mb-2",
    3: "text-base font-bold mt-3 mb-1",
    4: "text-sm font-bold mt-2 mb-1",
    5: "text-sm font-semibold mt-2 mb-1",
    6: "text-sm font-medium mt-2 mb-1",
  };
  return `<h${token.depth} class="${sizes[token.depth] ?? "text-sm font-bold mt-2 mb-1"}">${text}</h${token.depth}>`;
};



renderer.blockquote = function (token: Tokens.Blockquote): string {
  const body = this.parser.parse(token.tokens);
  return `<blockquote class="border-l-4 border-gray-400 pl-3 my-2 text-gray-600 italic">${body}</blockquote>`;
};

renderer.paragraph = function (token: Tokens.Paragraph): string {
  const text = this.parser.parseInline(token.tokens);
  return `<p class="my-1 leading-7">${text}</p>`;
};

renderer.codespan = function (token: Tokens.Codespan): string {
  return `<code class="inline-code">${token.text}</code>`;
};

renderer.strong = function (token: Tokens.Strong): string {
  const text = this.parser.parseInline(token.tokens);
  return `<strong class="font-bold">${text}</strong>`;
};

renderer.em = function (token: Tokens.Em): string {
  const text = this.parser.parseInline(token.tokens);
  return `<em class="italic">${text}</em>`;
};

renderer.link = function (token: Tokens.Link): string {
  const text = this.parser.parseInline(token.tokens);
  return `<a href="${token.href}" class="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

renderer.br = function (): string {
  return `<br/>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

export function renderMarkdown(content: string): string {
  return DOMPurify.sanitize(marked.parse(content) as string, {
    ADD_ATTR: ["data-code", "target", "rel"],
  });
}
