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

// export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
//   method: "POST",
//   handler: async (c) => {
//     try {
//       const mastra = c.get("mastra");
//       const agentId = c.req.param("agentId");
//       const body = await c.req.json();
//       const { jsonrpc, id: requestId, method, params } = body;

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

//       let agentResponseText = "";
//       let userMessage = "";

//       /**
//        * =============================
//        * HANDLE TELELEX MESSAGE/SEND
//        * =============================
//        */
//       if (method === "message/send") {
//         const { message, configuration } = params || {};

//         if (!message || !message.parts) {
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

//         // Extract text from message parts
//         userMessage = message.parts
//           .filter((part: MessagePart) => part.kind === "text" && part.text)
//           .map((part: MessagePart) => part.text)
//           .join(" ")
//           .trim();

//         // 👇 Build input for the agent (Mastra expects action + context)
//         const agentInput = {
//           action: "generateWords", // Default action (required)
//           context: userMessage || "No context provided",
//         };

//         // Run the agent (either custom or built-in)
//         if (agentId === "wordAgent") {
//           const response = await wordAgent.generate(agentInput);
//           agentResponseText = response.text;
//         } else {
//           const agent = mastra.getAgent(agentId);
//           if (!agent) {
//             return c.json(
//               {
//                 jsonrpc: "2.0",
//                 id: requestId,
//                 error: {
//                   code: -32602,
//                   message: `Agent '${agentId}' not found`,
//                 },
//               },
//               404
//             );
//           }

//           const response = await agent.run(agentInput);
//           agentResponseText =
//             response?.output?.text || response?.text || "No output generated";
//         }

//         const taskId = randomUUID();
//         const contextId = message.messageId || randomUUID();
//         const messageId = randomUUID();

//         // Artifacts
//         const artifacts = [
//           {
//             artifactId: randomUUID(),
//             name: `${agentId}Response`,
//             parts: [{ kind: "text", text: agentResponseText }],
//           },
//         ];

//         // History
//         const history = [
//           {
//             messageId: message.messageId || randomUUID(),
//             role: "user",
//             parts: message.parts,
//             kind: "message",
//           },
//           {
//             messageId,
//             role: "agent",
//             parts: [{ kind: "text", text: agentResponseText }],
//             kind: "message",
//           },
//         ];

//         // ✅ A2A-compliant response (Telex expects this)
//         return c.json({
//           jsonrpc: "2.0",
//           id: requestId,
//           result: {
//             id: taskId,
//             contextId,
//             status: {
//               state: "completed",
//               timestamp: new Date().toISOString(),
//               message: {
//                 messageId,
//                 role: "agent",
//                 parts: [{ kind: "text", text: agentResponseText }],
//                 kind: "message",
//               },
//             },
//             artifacts,
//             history,
//             kind: "task",
//           },
//         });
//       } else if (method === "agent:run") {

//       /**
//        * =============================
//        * HANDLE MASTRA AGENT:RUN
//        * =============================
//        */
//         const { input, messages } = params || {};

//         if (input && input.action) {
//           const { action, context, formalityLevel } = input;
//           userMessage = `Find words for "${action}"${context ? ` in context: ${context}` : ""}${formalityLevel ? ` (${formalityLevel} formality)` : ""}`;
//         } else if (messages && messages.length > 0) {
//           userMessage = messages
//             .filter((msg: any) => msg.role === "user")
//             .map(
//               (msg: any) =>
//                 msg.content || msg.parts?.map((p: any) => p.text).join(" ")
//             )
//             .join(" ");
//         } else {
//           return c.json(
//             {
//               jsonrpc: "2.0",
//               id: requestId,
//               error: {
//                 code: -32602,
//                 message:
//                   'Invalid params: either "input.action" or "messages" is required',
//               },
//             },
//             400
//           );
//         }

//         // Run agent
//         const agent =
//           agentId === "wordAgent"
//             ? wordAgent
//             : mastra.getAgent(agentId) || null;

//         if (!agent) {
//           return c.json(
//             {
//               jsonrpc: "2.0",
//               id: requestId,
//               error: {
//                 code: -32602,
//                 message: `Agent '${agentId}' not found`,
//               },
//             },
//             404
//           );
//         }

//         const response =
//           "generate" in agent
//             ? await agent.generate(userMessage)
//             : await agent.run({ action: "analyze", context: userMessage });

//         agentResponseText =
//           response?.text || response?.output?.text || "No output generated";

//         const taskId = randomUUID();
//         const contextId = randomUUID();
//         const messageId = randomUUID();

//         const artifacts = [
//           {
//             artifactId: randomUUID(),
//             name: `${agentId}Response`,
//             parts: [{ kind: "text", text: agentResponseText }],
//           },
//         ];

//         const history = [
//           {
//             messageId: randomUUID(),
//             role: "user",
//             parts: [{ kind: "text", text: userMessage }],
//             kind: "message",
//           },
//           {
//             messageId,
//             role: "agent",
//             parts: [{ kind: "text", text: agentResponseText }],
//             kind: "message",
//           },
//         ];

//         return c.json({
//           jsonrpc: "2.0",
//           id: requestId,
//           result: {
//             id: taskId,
//             contextId,
//             status: {
//               state: "completed",
//               timestamp: new Date().toISOString(),
//               message: {
//                 messageId,
//                 role: "agent",
//                 parts: [{ kind: "text", text: agentResponseText }],
//                 kind: "message",
//               },
//             },
//             artifacts,
//             history,
//             kind: "task",
//           },
//         });
//       } else {

//       /**
//        * =============================
//        * UNSUPPORTED METHOD
//        * =============================
//        */
//         return c.json(
//           {
//             jsonrpc: "2.0",
//             id: requestId,
//             error: {
//               code: -32601,
//               message: `Method '${method}' not found. Supported: message/send, agent:run`,
//             },
//           },
//           404
//         );
//       }
//     } catch (error) {
//       const errMsg = error instanceof Error ? error.message : "Internal Error";
//       const errStack = error instanceof Error ? error.stack : "";
//       console.error("A2A route error:", errMsg);
//       console.error("Stack:", errStack);

//       return c.json(
//         {
//           jsonrpc: "2.0",
//           id: null,
//           error: {
//             code: -32603,
//             message: errMsg,
//             data: {
//               stack:
//                 process.env.NODE_ENV === "development" ? errStack : undefined,
//             },
//           },
//         },
//         500
//       );
//     }
//   },
// });

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

      const extractTextFromParts = (parts: any): string => {
        if (!Array.isArray(parts)) return "";
        const texts: string[] = [];

        const collect = (p: any) => {
          if (!p) return;
          if (typeof p === "string") {
            texts.push(p);
            return;
          }
          if (p.text && typeof p.text === "string") {
            texts.push(p.text);
          }
          if (Array.isArray(p.data)) {
            p.data.forEach(collect);
          } else if (p.data && typeof p.data === "object") {
            collect(p.data);
          }
        };

        parts.forEach(collect);
        return texts.join(" ").replace(/\s+/g, " ").trim();
      };

      // We'll produce a normalized `input` object that your agents expect.
      let input: {
        action?: string;
        context?: string;
        formalityLevel?: string;
      } = {};

      // If Telex-style message/send
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

        const userText = extractTextFromParts(message.parts);
        console.log("🟢 Extracted user text:", userText);
        // Put the whole user text into context and make action the core (for now, we use the whole text as action).
        // You can use a NLP step here to extract verb if you want.
        input = {
          action: userText || undefined,
          context: userText || undefined,
          formalityLevel: undefined,
        };

        // Optionally consider configuration.blocking if you want async push behavior:
        // const isBlocking = configuration?.blocking !== false;
      }

      // If Mastra direct agent:run
      else if (method === "agent:run") {
        const { input: providedInput } = params || {};
        input = {
          action: providedInput?.action,
          context: providedInput?.context,
          formalityLevel: providedInput?.formalityLevel,
        };
      }

      // If still no action, return the same error your other code returned
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

      // DEBUG: log what will be sent to the agent (helps you verify)
      console.log(`[a2aAgentRoute] agentId=${agentId} requestId=${requestId}`);
      console.log(
        "[a2aAgentRoute] normalized input:",
        JSON.stringify(input, null, 2)
      );

      // Resolve agent (custom or Mastra agent)
      const agent =
        agentId === "wordAgent" ? wordAgent : mastra.getAgent(agentId);

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

      // Call agent: prefer structured .run(input) (Mastra style).
      // Fallback: if agent only exposes generate(prompt), build a prompt
      let agentText = "";
      let agentResponse: any = null;

      if (typeof (agent as any).run === "function") {
        // Mastra-style run with structured input
        agentResponse = await (agent as any).run(input);
        // Try common locations for returned text
        agentText =
          agentResponse?.output?.text ||
          agentResponse?.result?.text ||
          agentResponse?.text ||
          String(agentResponse || "");
      } else if (typeof (agent as any).generate === "function") {
        // Fallback: agent.generate expects a prompt string
        const prompt = `Find appropriate words and synonyms for the action: "${input.action}"
${input.context ? `Context: ${input.context}` : ""}
${input.formalityLevel ? `Formality: ${input.formalityLevel}` : ""}`;
        agentResponse = await (agent as any).generate(prompt);
        agentText = agentResponse?.text || String(agentResponse || "");
      } else {
        throw new Error("Agent does not support run() or generate()");
      }

      // Build artifacts & history (A2A)
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

      // If agent returned toolResults array, include them as data parts
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

      // Return A2A-compliant response (exact structure you requested)
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
