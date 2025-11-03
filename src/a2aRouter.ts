import { registerApiRoute } from "@mastra/core/server";
import { randomUUID } from "crypto";
import { wordAgent } from "../src/mastra/agents/word-agent";

function extractAllText(parts: any | any[]): string {
  const texts: string[] = [];

  const walk = (node: any) => {
    if (!node) return;

    // Plain string
    if (typeof node === "string") {
      texts.push(node);
      return;
    }

    // Regular part: { kind: "text", text: "…" }
    if (
      typeof node === "object" &&
      "text" in node &&
      typeof node.text === "string"
    ) {
      texts.push(node.text);
    }

    // Nested data – could be an array or a single object
    if (node && typeof node === "object") {
      if (Array.isArray(node.data)) {
        node.data.forEach(walk);
      } else if (node.data && typeof node.data === "object") {
        walk(node.data);
      }
    }
  };

  if (Array.isArray(parts)) {
    parts.forEach(walk);
  } else {
    walk(parts);
  }

  return texts.join(" ").replace(/\s+/g, " ").trim();
}

export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
  method: "POST",

  handler: async (c) => {
    try {
      const mastra = c.get("mastra");
      const agentId = c.req.param("agentId");
      const body = await c.req.json();

      const { jsonrpc, id: requestId, method, params } = body;

      // ---------- Basic JSON‑RPC validation ----------
      if (jsonrpc !== "2.0" || !requestId) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId || null,
            error: {
              code: -32600,
              message:
                'Invalid Request: "jsonrpc" must be "2.0" and "id" is required',
            },
          },
          400
        );
      }

      // ---------- Build the structured input ----------
      let input: {
        action?: string;
        context?: string;
        formalityLevel?: string;
      } = {};

      if (method === "message/send") {
        const { message, configuration } = params || {};

        if (!message || !Array.isArray(message.parts)) {
          return c.json(
            {
              jsonrpc: "2.0",
              id: requestId,
              error: {
                code: -32602,
                message: 'Invalid params: "message" with "parts" is required',
              },
            },
            400
          );
        }

        const userText = extractAllText(message.parts);
        // console.log(
        //   "Extracted user text:",
        //   JSON.stringify(userText, null, 2)
        // );

        // If extraction failed for some reason, fall back to the first part's text
        const fallback =
          !userText && message.parts[0]?.text
            ? message.parts[0].text
            : undefined;

        input = {
          action: userText || fallback || undefined,
          context: userText || fallback || undefined,
          formalityLevel: undefined,
        };

        // optional: const isBlocking = configuration?.blocking !== false;
      } else if (method === "agent:run") {
        const { input: providedInput } = params || {};
        input = {
          action: providedInput?.action,
          context: providedInput?.context,
          formalityLevel: providedInput?.formalityLevel,
        };
      } else {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32601,
              message: `Method "${method}" not supported`,
            },
          },
          400
        );
      }

      // ---------- Ensure we have an action ----------
      if (!input.action || input.action.trim() === "") {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32602,
              message: 'Invalid params: "action" is required in input',
            },
          },
          400
        );
      }

      console.log(`[a2aAgentRoute] agentId=${agentId} requestId=${requestId}`);
      console.log(
        "[a2aAgentRoute] normalized input:",
        JSON.stringify(input, null, 2)
      );

      // ---------- Resolve the agent ----------
      const agent =
        agentId === "wordAgent" ? wordAgent : mastra.getAgent(agentId);

      if (!agent) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32602,
              message: `Agent '${agentId}' not found`,
            },
          },
          404
        );
      }

      // ---------- Call the agent ----------
      let agentText = "";
      let agentResponse: any = null;

      if (typeof (agent as any).run === "function") {
        agentResponse = await (agent as any).run(input);
        agentText =
          agentResponse?.output?.text ??
          agentResponse?.result?.text ??
          agentResponse?.text ??
          String(agentResponse ?? "");
      } else if (typeof (agent as any).generate === "function") {
        const prompt = `Find appropriate words and synonyms for the action: "${input.action}"\n${
          input.context ? `Context: ${input.context}\n` : ""
        }${input.formalityLevel ? `Formality: ${input.formalityLevel}` : ""}`;
        agentResponse = await (agent as any).generate(prompt);
        agentText = agentResponse?.text ?? String(agentResponse ?? "");
      } else {
        throw new Error("Agent does not support run() or generate()");
      }

      // ---------- Build A2A artifacts & history ----------
      const taskId = randomUUID();
      const contextId = randomUUID();
      const messageId = randomUUID();

      const artifacts = [
        {
          artifactId: randomUUID(),
          name: `${agentId}Response`,
          parts: [{ kind: "text", text: agentText }],
        },
      ];

      if (
        agentResponse?.toolResults &&
        Array.isArray(agentResponse.toolResults) &&
        agentResponse.toolResults.length
      ) {
        artifacts.push({
          artifactId: randomUUID(),
          name: "ToolResults",
          parts: agentResponse.toolResults.map((r: any) => ({
            kind: "data",
            data: r,
          })),
        });
      }

      const history = [
        {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: input.context || input.action || "" }],
          messageId: randomUUID(),
          taskId,
        },
        {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: agentText }],
          messageId,
          taskId,
        },
      ];

      // ---------- Return A2A‑compatible JSON‑RPC response ----------
      return c.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          id: taskId,
          contextId,
          status: {
            state: "completed",
            timestamp: new Date().toISOString(),
            message: {
              messageId: randomUUID(),
              role: "agent",
              parts: [{ kind: "text", text: agentText }],
              kind: "message",
            },
          },
          artifacts,
          history,
          kind: "task",
        },
      });
    } catch (error: any) {
      console.error("A2A route error:", error);
      const message = error instanceof Error ? error.message : "Internal error";
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message,
            data: { details: message },
          },
        },
        500
      );
    }
  },
});
