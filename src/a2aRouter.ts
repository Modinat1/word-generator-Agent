import { registerApiRoute } from "@mastra/core/server";
import { randomUUID } from "crypto";
import { wordAgent } from "../src/mastra/agents/word-agent";

export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
  method: "POST",

  handler: async (c) => {
    try {
      const mastra = c.get("mastra");
      const agentId = c.req.param("agentId");
      const body = await c.req.json();

      const { jsonrpc, id: requestId, method, params } = body || {};

      // --- Basic JSON-RPC validation ---
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

      // --- Expect only Telex's "message/send" method ---
      if (method !== "message/send") {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32601,
              message: `Unsupported method: "${method}". Only "message/send" is allowed.`,
            },
          },
          400
        );
      }

      // --- Extract text from Telex message ---
      const userText =
        params?.message?.parts
          ?.find((p: any) => p.kind === "text")
          ?.text?.trim() || "";

      if (!userText) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32602,
              message: 'Invalid params: "message.parts[0].text" is required',
            },
          },
          400
        );
      }

      // --- Prepare input for Mastra agent ---
      const input = {
        action: userText,
        context: userText,
      };

      // --- Resolve agent ---
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

      // --- Call agent ---
      let agentResponse: any;
      let agentText = "";

      if (typeof (agent as any).run === "function") {
        agentResponse = await (agent as any).run(input);
        agentText =
          agentResponse?.output?.text ??
          agentResponse?.result?.text ??
          agentResponse?.text ??
          String(agentResponse ?? "");
      } else if (typeof (agent as any).generate === "function") {
        agentResponse = await (agent as any).generate(userText);
        agentText = agentResponse?.text ?? String(agentResponse ?? "");
      } else {
        throw new Error("Agent does not support run() or generate()");
      }

      // --- Build artifact from the agent response ---
      const artifactId = randomUUID();
      const artifacts = [
        {
          artifactId,
          name: `${agentId}-response-artifact`,
          createdAt: new Date().toISOString(),
          parts: [
            {
              kind: "text",
              text: agentText,
            },
          ],
        },
      ];

      // --- Build A2A Telex-style response ---
      const taskId = randomUUID();
      const contextId = randomUUID();
      const messageId = randomUUID();

      const result = {
        id: randomUUID(),
        status: {
          state: "completed",
          timestamp: new Date().toISOString(),
          message: {
            kind: "message",
            role: "agent",
            parts: [
              {
                kind: "text",
                text: agentText,
              },
              {
                kind: "data",
                data: {
                  artifacts,
                },
              },
            ],
            messageId,
            taskId,
            contextId,
          },
        },
        artifacts,
        kind: "task",
      };

      // --- Send successful JSON-RPC response ---
      return c.json({
        jsonrpc: "2.0",
        id: requestId,
        result,
      });
    } catch (error: any) {
      console.error("A2A route error:", error);
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: error?.message || "Internal server error",
          },
        },
        500
      );
    }
  },
});
