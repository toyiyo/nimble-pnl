import { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, ChefHat, User, Wrench } from "lucide-react";
import { ChatMessage as ChatMessageType } from "@/types/ai-chat";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: ChatMessageType;
  onNavigate?: (path: string) => void;
}

// Initialize mermaid
mermaid.initialize({
  startOnLoad: true,
  theme: "default",
  securityLevel: "strict",
});

const MermaidChart = ({ chart }: { chart: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (ref.current) {
      setError(false);
      try {
        // Clean up the chart text - remove markdown code block markers
        let cleanChart = chart
          .trim()
          .replace(/^```mermaid\n?/, "")
          .replace(/\n?```$/, "")
          .trim();

        // Skip rendering if chart is empty or too short to be valid
        if (!cleanChart || cleanChart.length < 10) {
          return;
        }

        // Sanitize the chart - replace problematic unicode characters
        cleanChart = cleanChart
          .replace(/[\u2011\u2012\u2013\u2014\u2015]/g, "-") // Replace various dashes with regular hyphen
          .replace(/[\u2018\u2019]/g, "'") // Replace smart quotes with regular quotes
          .replace(/[\u201C\u201D]/g, '"') // Replace smart double quotes
          .replace(/\u00A0/g, " ") // Replace non-breaking spaces
          .trim();

        // Validate basic mermaid syntax - check for incomplete arrows
        const lines = cleanChart.split("\n");
        const validLines = lines.filter((line) => {
          const trimmedLine = line.trim();
          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith("%%")) return true;
          // Check for incomplete arrows (arrows that end the line without a destination)
          if (/--[->]?\s*$/.test(trimmedLine)) return false;
          return true;
        });

        if (validLines.length < lines.length) {
          console.warn("Mermaid: Removed incomplete arrow syntax");
          cleanChart = validLines.join("\n");
        }

        mermaid
          .render(`mermaid-${Date.now()}`, cleanChart)
          .then(({ svg }) => {
            if (ref.current) {
              ref.current.innerHTML = svg;
            }
          })
          .catch((e) => {
            console.error("Mermaid rendering error:", e);
            setError(true);
          });
      } catch (e) {
        console.error("Mermaid rendering error:", e);
        setError(true);
      }
    }
  }, [chart]);

  if (error) {
    return (
      <div className="my-4 p-4 bg-muted/50 border border-border rounded-md">
        <p className="text-sm text-muted-foreground">
          Unable to render diagram. The chart syntax may be incomplete or invalid.
        </p>
      </div>
    );
  }

  return <div ref={ref} className="my-4 overflow-x-auto max-w-full" />;
};

/** Route and button label for each section of the `navigate` tool. */
const NAVIGATION_SECTIONS: Record<string, { path: string; label: string }> = {
  dashboard: { path: "/", label: "Dashboard" },
  inventory: { path: "/inventory", label: "Inventory" },
  recipes: { path: "/recipes", label: "Recipes" },
  "pos-sales": { path: "/pos-sales", label: "POS Sales" },
  banking: { path: "/banking", label: "Banking" },
  transactions: { path: "/transactions", label: "Transactions" },
  accounting: { path: "/accounting", label: "Accounting" },
  "financial-statements": { path: "/financial-statements", label: "Financial Statements" },
  "financial-intelligence": { path: "/financial-intelligence", label: "Financial Intelligence" },
  reports: { path: "/reports", label: "Reports" },
  integrations: { path: "/integrations", label: "Integrations" },
  team: { path: "/team", label: "Team" },
  settings: { path: "/settings", label: "Settings" },
};

/**
 * Object.hasOwn needs the ES2022 lib, and tsconfig.app.json does not include it.
 * This check gives the same result.
 */
function hasOwnKey(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

interface NavigationTarget {
  path: string;
  label: string;
}

/**
 * Gives the target of a `navigate` tool call. It gives null for a section that
 * is not an own key of NAVIGATION_SECTIONS, so "__proto__" and unknown values
 * show no button.
 */
function navigationTarget(argumentsJson: string): NavigationTarget | null {
  let args: { section?: unknown; entity_id?: unknown };
  try {
    args = JSON.parse(argumentsJson);
  } catch (e) {
    console.error("Failed to parse navigation tool call:", e);
    return null;
  }
  if (!args || typeof args.section !== "string" || !hasOwnKey(NAVIGATION_SECTIONS, args.section)) {
    return null;
  }
  const section = NAVIGATION_SECTIONS[args.section];
  const entityId = args.entity_id;
  const hasEntity =
    (typeof entityId === "string" && entityId !== "") ||
    (typeof entityId === "number" && Number.isFinite(entityId));
  const path = hasEntity ? `${section.path}?id=${encodeURIComponent(String(args.entity_id))}` : section.path;
  return { path, label: section.label };
}

// The markdown settings are module constants. New objects on each render make
// ReactMarkdown parse and render the message again.
const REMARK_PLUGINS = [remarkGfm];

// Each renderer removes `node` (the syntax tree node) so it does not go to the DOM.
const MARKDOWN_COMPONENTS: Components = {
  code({ node: _node, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");
    const inline = !className;

    if (match && match[1] === "mermaid") {
      return <MermaidChart chart={code} />;
    }

    if (!inline && match) {
      return (
        <pre className="bg-background/50 p-3 rounded-md overflow-x-auto max-w-full">
          <code className={cn(className, "block break-words whitespace-pre-wrap")} {...props}>
            {children}
          </code>
        </pre>
      );
    }

    return (
      <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm break-words" {...props}>
        {children}
      </code>
    );
  },
  a({ node: _node, children, ...props }) {
    return (
      <a {...props} className="text-primary hover:underline break-words" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  ul({ node: _node, children, ...props }) {
    return (
      <ul className="list-disc list-inside space-y-1 break-words" {...props}>
        {children}
      </ul>
    );
  },
  ol({ node: _node, children, ...props }) {
    return (
      <ol className="list-decimal list-inside space-y-1 break-words" {...props}>
        {children}
      </ol>
    );
  },
  p({ node: _node, children, ...props }) {
    return (
      <p className="break-words" {...props}>
        {children}
      </p>
    );
  },
  h1({ node: _node, children, ...props }) {
    return (
      <h1 className="break-words text-xl md:text-2xl" {...props}>
        {children}
      </h1>
    );
  },
  h2({ node: _node, children, ...props }) {
    return (
      <h2 className="break-words text-lg md:text-xl" {...props}>
        {children}
      </h2>
    );
  },
  h3({ node: _node, children, ...props }) {
    return (
      <h3 className="break-words text-base md:text-lg" {...props}>
        {children}
      </h3>
    );
  },
  table({ node: _node, children, ...props }) {
    return (
      <div className="overflow-x-auto my-4 max-w-full">
        <table className="min-w-full border-collapse border border-border" {...props}>
          {children}
        </table>
      </div>
    );
  },
  th({ node: _node, children, ...props }) {
    return (
      <th
        className="border border-border px-2 md:px-4 py-2 bg-muted font-semibold text-left text-xs md:text-sm break-words"
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ node: _node, children, ...props }) {
    return (
      <td className="border border-border px-2 md:px-4 py-2 text-xs md:text-sm break-words" {...props}>
        {children}
      </td>
    );
  },
};

function ChatMessageView({ message, onNavigate }: ChatMessageProps) {
  const navigate = useNavigate();
  const isUser = message.role === "user";
  const toolCalls = message.tool_calls ?? [];
  const hasText = Boolean(message.content?.trim());

  // Tool rows are internal. A row with no text and no tool calls has nothing to show.
  // The panel shows its own indicator while a response streams.
  if (message.role === "tool" || (!hasText && toolCalls.length === 0)) {
    return null;
  }

  const navigationTool = toolCalls.find((tc) => tc.function.name === "navigate");
  const target = navigationTool ? navigationTarget(navigationTool.function.arguments) : null;

  const handleNavigate = () => {
    if (!target) return;
    if (onNavigate) {
      onNavigate(target.path);
    } else {
      navigate(target.path);
    }
  };

  return (
    <div className={cn("flex gap-3 mb-4", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
            <ChefHat className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
          </div>
        </div>
      )}

      <Card
        className={cn(
          "max-w-[85%] md:max-w-[80%] px-4 py-3 break-words overflow-hidden",
          isUser
            ? "bg-primary text-primary-foreground [&_.prose]:text-primary-foreground [&_.prose_*]:text-primary-foreground"
            : "bg-muted",
        )}
      >
        {hasText && (
          <div className={cn("prose prose-sm max-w-none", !isUser && "dark:prose-invert")}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {target && (
          <div className={cn(hasText && "mt-3 pt-3 border-t border-border/50")}>
            <Button onClick={handleNavigate} size="sm" className="w-full" variant="default">
              <ArrowRight className="h-4 w-4 mr-2" aria-hidden="true" />
              Go to {target.label}
            </Button>
          </div>
        )}

        {toolCalls.length > 0 && (
          <div className={cn((hasText || target) && "mt-2 pt-2 border-t border-border/50")}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wrench className="h-3 w-3" aria-hidden="true" />
              <span>Using tools: {toolCalls.map((tc) => tc.function.name).join(", ")}</span>
            </div>
          </div>
        )}
      </Card>

      {isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <User className="h-5 w-5 text-secondary-foreground" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The hook replaces a message object only when the message changes. A stream
 * delta then renders only the message that it changes. The shallow compare of
 * memo is enough, because the props are the message and the onNavigate callback.
 */
export const ChatMessage = memo(ChatMessageView);
