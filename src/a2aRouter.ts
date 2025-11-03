import { registerApiRoute } from "@mastra/core/server";
import { randomUUID } from "crypto";
import { wordAgent } from "../src/mastra/agents/word-agent";

/**
 * Extract only the LATEST/MOST RECENT user text from message parts
 * This function prioritizes the first direct text part and ignores nested history
 */
function extractLatestUserText(parts: any[]): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }

  // Strategy 1: Find the first part with kind="text" and text property
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      part.kind === "text" &&
      typeof part.text === "string"
    ) {
      const cleaned = part.text.trim();
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }

  // Strategy 2: If no direct text found, look for the first text in data array
  // But only take the FIRST item to avoid getting conversation history
  for (const part of parts) {
    if (
      part &&
      part.kind === "data" &&
      Array.isArray(part.data) &&
      part.data.length > 0
    ) {
      const firstDataItem = part.data[0];
      if (
        firstDataItem &&
        firstDataItem.kind === "text" &&
        typeof firstDataItem.text === "string"
      ) {
        // Extract text from HTML if present
        const text = firstDataItem.text.replace(/<[^>]*>/g, "").trim();
        if (text.length > 0) {
          return text;
        }
      }
    }
  }

  return "";
}

export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
  method: "POST",

  handler: async (c) => {
    try {
      const mastra = c.get("mastra");
      const agentId = c.req.param("agentId");
      const body = await c.req.json();

      const { jsonrpc, id: requestId, method, params } = body;

      console.log("📥 Incoming request:", {
        agentId,
        method,
        requestId,
        paramsKeys: Object.keys(params || {}),
      });

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
        action: string;
        context?: string;
        formalityLevel?: string;
      } = {
        action: "",
      };

      let originalMessage: any = null;
      let configuration: any = null;

      if (method === "message/send") {
        const { message, configuration: config } = params || {};
        originalMessage = message;
        configuration = config;

        if (!message || !Array.isArray(message.parts)) {
          console.error("❌ Invalid message structure:", message);
          return c.json(
            {
              jsonrpc: "2.0",
              id: requestId,
              error: {
                code: -32602,
                message:
                  'Invalid params: "message" with "parts" array is required',
              },
            },
            400
          );
        }

        console.log(
          "📝 Message parts:",
          JSON.stringify(message.parts, null, 2)
        );

        // Extract ONLY the latest user text
        const userText = extractLatestUserText(message.parts);

        console.log("✅ Extracted user text:", userText);

        if (!userText || userText.trim() === "") {
          console.error("❌ No text extracted from message parts");
          return c.json(
            {
              jsonrpc: "2.0",
              id: requestId,
              error: {
                code: -32602,
                message:
                  "Invalid params: Could not extract text from message parts",
              },
            },
            400
          );
        }

        input = {
          action: userText,
          context: undefined,
          formalityLevel: undefined,
        };
      } else if (method === "agent:run") {
        const { input: providedInput } = params || {};

        if (!providedInput || !providedInput.action) {
          return c.json(
            {
              jsonrpc: "2.0",
              id: requestId,
              error: {
                code: -32602,
                message:
                  'Invalid params: "input.action" is required for agent:run method',
              },
            },
            400
          );
        }

        input = {
          action: providedInput.action,
          context: providedInput.context,
          formalityLevel: providedInput.formalityLevel,
        };
      } else {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32601,
              message: `Method "${method}" not supported. Use "message/send" or "agent:run"`,
            },
          },
          400
        );
      }

      // ---------- Final validation ----------
      if (!input.action || input.action.trim() === "") {
        console.error("❌ Empty action after extraction:", input);
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32602,
              message:
                'Invalid params: "action" is required and cannot be empty',
            },
          },
          400
        );
      }

      console.log(`🎯 Processing with agent: ${agentId}`);
      console.log("📋 Input:", JSON.stringify(input, null, 2));

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

      console.log("🤖 Calling agent...");

      try {
        if (typeof (agent as any).generate === "function") {
          // Use natural language prompt
          const prompt = input.action; // Just send the user's message directly

          agentResponse = await (agent as any).generate(prompt);
          agentText = agentResponse?.text ?? String(agentResponse ?? "");
        } else if (typeof (agent as any).run === "function") {
          agentResponse = await (agent as any).run(input);
          agentText =
            agentResponse?.output?.text ??
            agentResponse?.result?.text ??
            agentResponse?.text ??
            String(agentResponse ?? "");
        } else {
          throw new Error("Agent does not support generate() or run()");
        }

        console.log("✅ Agent responded. Text length:", agentText.length);
      } catch (agentError: any) {
        console.error("❌ Agent execution error:", agentError);
        throw agentError;
      }

      // ---------- Build A2A artifacts & history ----------
      const taskId = randomUUID();
      const contextId = originalMessage?.messageId || randomUUID();
      const agentMessageId = randomUUID();

      const artifacts = [
        {
          artifactId: randomUUID(),
          name: `${agentId}Response`,
          parts: [{ kind: "text", text: agentText }],
        },
      ];

      // Add tool results as artifacts if available
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

      // Build conversation history
      const history = [
        {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: input.action }],
          messageId: originalMessage?.messageId || randomUUID(),
          taskId,
        },
        {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: agentText }],
          messageId: agentMessageId,
          taskId,
        },
      ];

      // ---------- Handle non-blocking requests with push notifications ----------
      const isBlocking = configuration?.blocking !== false;

      if (!isBlocking && configuration?.pushNotificationConfig) {
        console.log("📤 Non-blocking request - sending push notification");

        const { url, token } = configuration.pushNotificationConfig;

        // Send immediate acknowledgment
        const response = {
          jsonrpc: "2.0",
          id: requestId,
          result: {
            id: taskId,
            contextId,
            status: {
              state: "pending",
              timestamp: new Date().toISOString(),
            },
            kind: "task",
          },
        };

        // Send notification asynchronously
        sendPushNotification(
          url,
          token,
          taskId,
          contextId,
          agentMessageId,
          agentText,
          input.action,
          originalMessage?.messageId
        ).catch((err) => console.error("❌ Push notification failed:", err));

        return c.json(response);
      }

      // ---------- Return A2A‑compatible JSON‑RPC response (blocking) ----------
      console.log("✅ Sending blocking response");

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
              messageId: agentMessageId,
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
      console.error("❌ A2A route error:", error);
      const message = error instanceof Error ? error.message : "Internal error";
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message,
            data: {
              details: message,
              stack:
                process.env.NODE_ENV === "development"
                  ? error.stack
                  : undefined,
            },
          },
        },
        500
      );
    }
  },
});

// Helper function to send push notifications
async function sendPushNotification(
  url: string,
  token: string,
  taskId: string,
  contextId: string,
  messageId: string,
  agentText: string,
  userText: string,
  userMessageId?: string
) {
  try {
    const notification = {
      id: taskId,
      contextId,
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
        message: {
          messageId,
          role: "agent",
          parts: [{ kind: "text", text: agentText }],
          kind: "message",
        },
      },
      artifacts: [
        {
          artifactId: randomUUID(),
          name: "wordAgentResponse",
          parts: [{ kind: "text", text: agentText }],
        },
      ],
      history: [
        {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: userText }],
          messageId: userMessageId || randomUUID(),
          taskId,
        },
        {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: agentText }],
          messageId,
          taskId,
        },
      ],
      kind: "task",
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(notification),
    });

    if (!response.ok) {
      throw new Error(
        `Push notification failed: ${response.status} ${response.statusText}`
      );
    }

    console.log("✅ Push notification sent successfully");
  } catch (error) {
    console.error("❌ Push notification error:", error);
    throw error;
  }
}

// import { registerApiRoute } from "@mastra/core/server";
// import { randomUUID } from "crypto";
// import { wordAgent } from "../src/mastra/agents/word-agent";

// function extractAllText(parts: any | any[]): string {
//   const texts: string[] = [];

//   const walk = (node: any) => {
//     if (!node) return;

//     // Plain string
//     if (typeof node === "string") {
//       texts.push(node);
//       return;
//     }

//     // Regular part: { kind: "text", text: "…" }
//     if (
//       typeof node === "object" &&
//       "text" in node &&
//       typeof node.text === "string"
//     ) {
//       texts.push(node.text);
//     }

//     // Nested data – could be an array or a single object
//     if (node && typeof node === "object") {
//       if (Array.isArray(node.data)) {
//         node.data.forEach(walk);
//       } else if (node.data && typeof node.data === "object") {
//         walk(node.data);
//       }
//     }
//   };

//   if (Array.isArray(parts)) {
//     parts.forEach(walk);
//   } else {
//     walk(parts);
//   }

//   return texts.join(" ").replace(/\s+/g, " ").trim();
// }

// export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
//   method: "POST",

//   handler: async (c) => {
//     try {
//       const mastra = c.get("mastra");
//       const agentId = c.req.param("agentId");
//       const body = await c.req.json();

//       const { jsonrpc, id: requestId, method, params } = body;

//       // ---------- Basic JSON‑RPC validation ----------
//       if (jsonrpc !== "2.0" || !requestId) {
//         return c.json(
//           {
//             jsonrpc: "2.0",
//             id: requestId || null,
//             error: {
//               code: -32600,
//               message:
//                 'Invalid Request: "jsonrpc" must be "2.0" and "id" is required',
//             },
//           },
//           400
//         );
//       }

//       // ---------- Build the structured input ----------
//       let input: {
//         action?: string;
//         context?: string;
//         formalityLevel?: string;
//       } = {};

//       if (method === "message/send") {
//         const { message, configuration } = params || {};

//         if (!message || !Array.isArray(message.parts)) {
//           return c.json(
//             {
//               jsonrpc: "2.0",
//               id: requestId,
//               error: {
//                 code: -32602,
//                 message: 'Invalid params: "message" with "parts" is required',
//               },
//             },
//             400
//           );
//         }

//         const userText = extractAllText(message.parts);
//         // console.log(
//         //   "Extracted user text:",
//         //   JSON.stringify(userText, null, 2)
//         // );

//         // If extraction failed for some reason, fall back to the first part's text
//         const fallback =
//           !userText && message.parts[0]?.text
//             ? message.parts[0].text
//             : undefined;

//         input = {
//           action: userText || fallback || undefined,
//           context: userText || fallback || undefined,
//           formalityLevel: undefined,
//         };

//         // optional: const isBlocking = configuration?.blocking !== false;
//       } else if (method === "agent:run") {
//         const { input: providedInput } = params || {};
//         input = {
//           action: providedInput?.action,
//           context: providedInput?.context,
//           formalityLevel: providedInput?.formalityLevel,
//         };
//       } else {
//         return c.json(
//           {
//             jsonrpc: "2.0",
//             id: requestId,
//             error: {
//               code: -32601,
//               message: `Method "${method}" not supported`,
//             },
//           },
//           400
//         );
//       }

//       // ---------- Ensure we have an action ----------
//       if (!input.action || input.action.trim() === "") {
//         return c.json(
//           {
//             jsonrpc: "2.0",
//             id: requestId,
//             error: {
//               code: -32602,
//               message: 'Invalid params: "action" is required in input',
//             },
//           },
//           400
//         );
//       }

//       console.log(`[a2aAgentRoute] agentId=${agentId} requestId=${requestId}`);
//       console.log(
//         "[a2aAgentRoute] normalized input:",
//         JSON.stringify(input, null, 2)
//       );

//       // ---------- Resolve the agent ----------
//       const agent =
//         agentId === "wordAgent" ? wordAgent : mastra.getAgent(agentId);

//       if (!agent) {
//         return c.json(
//           {
//             jsonrpc: "2.0",
//             id: requestId,
//             error: {
//               code: -32602,
//               message: `Agent '${agentId}' not found`,
//             },
//           },
//           404
//         );
//       }

//       // ---------- Call the agent ----------
//       let agentText = "";
//       let agentResponse: any = null;

//       if (typeof (agent as any).run === "function") {
//         agentResponse = await (agent as any).run(input);
//         agentText =
//           agentResponse?.output?.text ??
//           agentResponse?.result?.text ??
//           agentResponse?.text ??
//           String(agentResponse ?? "");
//       } else if (typeof (agent as any).generate === "function") {
//         const prompt = `Find appropriate words and synonyms for the action: "${input.action}"\n${
//           input.context ? `Context: ${input.context}\n` : ""
//         }${input.formalityLevel ? `Formality: ${input.formalityLevel}` : ""}`;
//         agentResponse = await (agent as any).generate(prompt);
//         agentText = agentResponse?.text ?? String(agentResponse ?? "");
//       } else {
//         throw new Error("Agent does not support run() or generate()");
//       }

//       // ---------- Build A2A artifacts & history ----------
//       const taskId = randomUUID();
//       const contextId = randomUUID();
//       const messageId = randomUUID();

//       const artifacts = [
//         {
//           artifactId: randomUUID(),
//           name: `${agentId}Response`,
//           parts: [{ kind: "text", text: agentText }],
//         },
//       ];

//       if (
//         agentResponse?.toolResults &&
//         Array.isArray(agentResponse.toolResults) &&
//         agentResponse.toolResults.length
//       ) {
//         artifacts.push({
//           artifactId: randomUUID(),
//           name: "ToolResults",
//           parts: agentResponse.toolResults.map((r: any) => ({
//             kind: "data",
//             data: r,
//           })),
//         });
//       }

//       const history = [
//         {
//           kind: "message",
//           role: "user",
//           parts: [{ kind: "text", text: input.context || input.action || "" }],
//           messageId: randomUUID(),
//           taskId,
//         },
//         {
//           kind: "message",
//           role: "agent",
//           parts: [{ kind: "text", text: agentText }],
//           messageId,
//           taskId,
//         },
//       ];

//       // ---------- Return A2A‑compatible JSON‑RPC response ----------
//       return c.json({
//         jsonrpc: "2.0",
//         id: requestId,
//         result: {
//           id: taskId,
//           contextId,
//           status: {
//             state: "completed",
//             timestamp: new Date().toISOString(),
//             message: {
//               messageId: randomUUID(),
//               role: "agent",
//               parts: [{ kind: "text", text: agentText }],
//               kind: "message",
//             },
//           },
//           artifacts,
//           history,
//           kind: "task",
//         },
//       });
//     } catch (error: any) {
//       console.error("A2A route error:", error);
//       const message = error instanceof Error ? error.message : "Internal error";
//       return c.json(
//         {
//           jsonrpc: "2.0",
//           id: null,
//           error: {
//             code: -32603,
//             message,
//             data: { details: message },
//           },
//         },
//         500
//       );
//     }
//   },
// });
