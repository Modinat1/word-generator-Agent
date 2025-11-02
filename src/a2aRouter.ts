import { registerApiRoute } from "@mastra/core/server";
import { randomUUID } from "crypto";
import { wordAgent } from "./mastra/agents/word-agent.js";

interface ArtifactPart {
  kind: "text" | "data";
  text?: string;
  data?: unknown;
}

interface Artifact {
  artifactId: string;
  name: string;
  parts: ArtifactPart[];
}

interface MessagePart {
  kind: "text" | "data";
  text?: string;
  data?: unknown;
}

interface Message {
  role: string;
  parts: MessagePart[];
  messageId?: string;
  taskId?: string;
}

export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
  method: "POST",
  handler: async (c) => {
    try {
      const mastra = c.get("mastra");
      const agentId = c.req.param("agentId");
      const body = await c.req.json();
      const { jsonrpc, id: requestId, method, params } = body;

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

      const { messages, input } = params || {};
      let agentResponseText = "";

      if (agentId === "wordAgent") {
        const { action, context, formalityLevel } = input || {};

        if (!action) {
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

        const prompt = `Please find words for the action "${action}"${context ? ` in the context of "${context}"` : ""}${formalityLevel ? ` with ${formalityLevel} formality level` : ""}.`;

        try {
          const response = await wordAgent.generate(prompt);
          agentResponseText = response.text;
        } catch (agentError: any) {
          throw agentError;
        }
      } else {
        // Default Mastra agent (if not wordAgent)
        const agent = mastra.getAgent(agentId);
        if (!agent) {
          return c.json(
            {
              jsonrpc: "2.0",
              id: requestId,
              error: { code: -32602, message: `Agent '${agentId}' not found` },
            },
            404
          );
        }

        const mastraMessages = (messages || []).map((msg: Message) => ({
          role: msg.role,
          content: msg.parts.map((p) => p.text || "").join(" "),
        }));

        const response = await agent.generate(mastraMessages);
        agentResponseText = response.text || "";
      }

      // JSON-RPC 2.0 response
      const artifactId = randomUUID();
      const taskId = randomUUID();

      return c.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          id: taskId,
          contextId: randomUUID(),
          status: {
            state: "completed",
            timestamp: new Date().toISOString(),
            message: {
              messageId: randomUUID(),
              role: "agent",
              parts: [{ kind: "text", text: agentResponseText }],
              kind: "message",
            },
          },
          artifacts: [
            {
              artifactId,
              name: `${agentId}Response`,
              parts: [{ kind: "text", text: agentResponseText }],
            },
          ],
          kind: "task",
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Internal Error";
      const errorStack = error instanceof Error ? error.stack : "";
      console.error("A2A route error:", errorMessage);
      console.error("Stack:", errorStack);

      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: errorMessage,
            data: { stack: errorStack },
          },
        },
        500
      );
    }
  },
});
