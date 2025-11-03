import { registerApiRoute } from "@mastra/core/server";
import { randomUUID } from "crypto";
import { wordAgent } from "../src/mastra/agents/word-agent";

interface MessagePart {
  kind: "text" | "data";
  text?: string;
  data?: unknown;
}

interface Message {
  kind: string;
  role: string;
  parts: MessagePart[];
  messageId?: string;
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

      let agentResponseText = "";
      let userMessage = "";

      // Handle different A2A methods
      if (method === "message/send") {
        // Standard A2A message format
        const { message, configuration } = params || {};

        if (!message || !message.parts) {
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

        // Extract text from message parts
        userMessage = message.parts
          .filter((part: MessagePart) => part.kind === "text" && part.text)
          .map((part: MessagePart) => part.text)
          .join(" ");

        // Process with wordAgent
        if (agentId === "wordAgent") {
          try {
            const response = await wordAgent.generate(userMessage);
            agentResponseText = response.text;
          } catch (agentError: any) {
            console.error("Agent error:", agentError.message);
            throw agentError;
          }
        } else {
          // Use other Mastra agents
          const agent = mastra.getAgent(agentId);
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

          const response = await agent.generate(userMessage);
          agentResponseText = response.text || "";
        }

        // Handle push notifications if blocking is false
        const isBlocking = configuration?.blocking !== false;

        if (!isBlocking && configuration?.pushNotificationConfig) {
          // For non-blocking requests, send notification asynchronously
          const { url, token } = configuration.pushNotificationConfig;

          // Send immediate acknowledgment
          const taskId = randomUUID();

          // Process in background
          processAndNotify(
            url,
            token,
            taskId,
            agentResponseText,
            message.parts,
            message.messageId
          ).catch(console.error);

          return c.json({
            jsonrpc: "2.0",
            id: requestId,
            result: {
              id: taskId,
              contextId: message.messageId || randomUUID(),
              status: {
                state: "pending",
                timestamp: new Date().toISOString(),
              },
              kind: "task",
            },
          });
        }

        // Blocking request - return immediately with full A2A structure
        const taskId = randomUUID();
        const contextId = message.messageId || randomUUID();
        const messageId = randomUUID();

        // Build artifacts array
        const artifacts = [
          {
            artifactId: randomUUID(),
            name: `${agentId}Response`,
            parts: [{ kind: "text", text: agentResponseText }],
          },
        ];

        // Build history array
        const history = [
          {
            messageId: message.messageId || randomUUID(),
            role: "user",
            parts: message.parts,
            kind: "message",
          },
          {
            messageId,
            role: "agent",
            parts: [{ kind: "text", text: agentResponseText }],
            kind: "message",
          },
        ];

        return c.json({
          jsonrpc: "2.0",
          id: requestId,
          result: {
            id: taskId,
            contextId: contextId,
            status: {
              state: "completed",
              timestamp: new Date().toISOString(),
              message: {
                messageId,
                role: "agent",
                parts: [{ kind: "text", text: agentResponseText }],
                kind: "message",
              },
            },
            artifacts,
            history,
            kind: "task",
          },
        });
      } else if (method === "agent:run") {
        // Custom method for direct agent invocation (your original format)
        const { input, messages } = params || {};

        if (input && input.action) {
          // Structured input format
          const { action, context, formalityLevel } = input;
          userMessage = `Find words for "${action}"${context ? ` in context: ${context}` : ""}${formalityLevel ? ` (${formalityLevel} formality)` : ""}`;
        } else if (messages && messages.length > 0) {
          // Messages array format
          userMessage = messages
            .filter((msg: any) => msg.role === "user")
            .map(
              (msg: any) =>
                msg.content || msg.parts?.map((p: any) => p.text).join(" ")
            )
            .join(" ");
        } else {
          return c.json(
            {
              jsonrpc: "2.0",
              id: requestId,
              error: {
                code: -32602,
                message:
                  'Invalid params: either "input.action" or "messages" is required',
              },
            },
            400
          );
        }

        // Process with agent
        if (agentId === "wordAgent") {
          const response = await wordAgent.generate(userMessage);
          agentResponseText = response.text;
        } else {
          const agent = mastra.getAgent(agentId);
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
          const response = await agent.generate(userMessage);
          agentResponseText = response.text || "";
        }

        const taskId = randomUUID();
        const contextId = randomUUID();
        const messageId = randomUUID();

        // Build artifacts array
        const artifacts = [
          {
            artifactId: randomUUID(),
            name: `${agentId}Response`,
            parts: [{ kind: "text", text: agentResponseText }],
          },
        ];

        // Build history array based on input format
        const history = [];

        if (input && input.action) {
          // For structured input, create synthetic history
          history.push(
            {
              messageId: randomUUID(),
              role: "user",
              parts: [{ kind: "text", text: userMessage }],
              kind: "message",
            },
            {
              messageId,
              role: "agent",
              parts: [{ kind: "text", text: agentResponseText }],
              kind: "message",
            }
          );
        } else if (messages && messages.length > 0) {
          // For messages array, convert to history format
          messages.forEach((msg: any) => {
            history.push({
              messageId: randomUUID(),
              role: msg.role,
              parts: msg.parts || [{ kind: "text", text: msg.content }],
              kind: "message",
            });
          });
          // Add agent response
          history.push({
            messageId,
            role: "agent",
            parts: [{ kind: "text", text: agentResponseText }],
            kind: "message",
          });
        }

        return c.json({
          jsonrpc: "2.0",
          id: requestId,
          result: {
            id: taskId,
            contextId: contextId,
            status: {
              state: "completed",
              timestamp: new Date().toISOString(),
              message: {
                messageId,
                role: "agent",
                parts: [{ kind: "text", text: agentResponseText }],
                kind: "message",
              },
            },
            artifacts,
            history,
            kind: "task",
          },
        });
      } else {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32601,
              message: `Method '${method}' not found. Supported: message/send, agent:run`,
            },
          },
          404
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Internal Error";
      const errStack = error instanceof Error ? error.stack : "";
      console.error("A2A route error:", errMsg);
      console.error("Stack:", errStack);

      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: errMsg,
            data: {
              stack:
                process.env.NODE_ENV === "development" ? errStack : undefined,
            },
          },
        },
        500
      );
    }
  },
});

// Helper function to send push notifications for non-blocking requests
async function processAndNotify(
  url: string,
  token: string,
  taskId: string,
  responseText: string,
  userParts: MessagePart[],
  userMessageId?: string
) {
  try {
    const agentMessageId = randomUUID();

    // Build artifacts
    const artifacts = [
      {
        artifactId: randomUUID(),
        name: "wordAgentResponse",
        parts: [{ kind: "text", text: responseText }],
      },
    ];

    // Build history
    const history = [
      {
        messageId: userMessageId || randomUUID(),
        role: "user",
        parts: userParts,
        kind: "message",
      },
      {
        messageId: agentMessageId,
        role: "agent",
        parts: [{ kind: "text", text: responseText }],
        kind: "message",
      },
    ];

    const notification = {
      id: taskId,
      contextId: userMessageId || randomUUID(),
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
        message: {
          messageId: agentMessageId,
          role: "agent",
          parts: [{ kind: "text", text: responseText }],
          kind: "message",
        },
      },
      artifacts,
      history,
      kind: "task",
    };

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(notification),
    });

    console.log("Push notification sent successfully");
  } catch (error) {
    console.error("Failed to send push notification:", error);
  }
}
