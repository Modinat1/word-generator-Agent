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

      //  Validate JSON-RPC 2.0 request
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

      // Extract user input
      let action = "";
      let context = "general";
      let formalityLevel = "neutral";

      if (method === "message/send") {
        const messageParts = params?.message?.parts || [];
        const textParts = messageParts.filter((p: any) => p.kind === "text");
        const userMessageText = textParts
          .map((p: any) => p.text)
          .join(" ")
          .trim();

        // Basic heuristic: use the first few words as the "action"
        // You can improve this parsing logic later if needed
        action = userMessageText || "unspecified action";
      } else if (method === "agent:run") {
        const { input } = params || {};
        action = input?.action || "";
        context = input?.context || "general";
        formalityLevel = input?.formalityLevel || "neutral";
      }

      // Validate required field
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

      //  Process the request using your wordAgent or a default agent
      let agentText = "";
      const taskId = randomUUID();
      const contextId = randomUUID();

      if (agentId === "wordAgent") {
        const prompt = `Please find words for the action "${action}"${
          context ? ` in the context of "${context}"` : ""
        }${formalityLevel ? ` with ${formalityLevel} formality level` : ""}.`;

        const response = await wordAgent.generate(prompt);
        agentText = response.text;
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

        const response = await agent.generate([
          { role: "user", content: action },
        ]);
        agentText = response.text || "";
      }

      // Build artifacts and history for A2A response
      const artifacts = [
        {
          artifactId: randomUUID(),
          name: `${agentId}Response`,
          parts: [{ kind: "text", text: agentText }],
        },
      ];

      const history = [
        {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: action }],
          messageId: randomUUID(),
          taskId,
        },
        {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: agentText }],
          messageId: randomUUID(),
          taskId,
        },
      ];

      // Return fully A2A-compliant JSON-RPC response
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
    } catch (error) {
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

// export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
//   method: "POST",
//   handler: async (c) => {
//     try {
//       const mastra = c.get("mastra");
//       const agentId = c.req.param("agentId");
//       const body = await c.req.json();
//       const { jsonrpc, id: requestId, method, params } = body;

//       // Validate JSON-RPC 2.0 format
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

//       const { messages, input } = params || {};
//       let agentResponseText = "";

//       if (agentId === "wordAgent") {
//         const { action, context, formalityLevel } = input || {};

//         if (!action) {
//           return c.json(
//             {
//               jsonrpc: "2.0",
//               id: requestId,
//               error: {
//                 code: -32602,
//                 message: 'Invalid params: "action" is required in input',
//               },
//             },
//             400
//           );
//         }

//         const prompt = `Please find words for the action "${action}"${context ? ` in the context of "${context}"` : ""}${formalityLevel ? ` with ${formalityLevel} formality level` : ""}.`;

//         try {
//           const response = await wordAgent.generate(prompt);
//           agentResponseText = response.text;
//         } catch (agentError: any) {
//           throw agentError;
//         }
//       } else {
//         // Default Mastra agent (if not wordAgent)
//         const agent = mastra.getAgent(agentId);
//         if (!agent) {
//           return c.json(
//             {
//               jsonrpc: "2.0",
//               id: requestId,
//               error: { code: -32602, message: `Agent '${agentId}' not found` },
//             },
//             404
//           );
//         }

//         const mastraMessages = (messages || []).map((msg: Message) => ({
//           role: msg.role,
//           content: msg.parts.map((p) => p.text || "").join(" "),
//         }));

//         const response = await agent.generate(mastraMessages);
//         agentResponseText = response.text || "";
//       }

//       // JSON-RPC 2.0 response
//       const artifactId = randomUUID();
//       const taskId = randomUUID();

//       return c.json({
//         jsonrpc: "2.0",
//         id: requestId,
//         result: {
//           id: taskId,
//           contextId: randomUUID(),
//           status: {
//             state: "completed",
//             timestamp: new Date().toISOString(),
//             message: {
//               messageId: randomUUID(),
//               role: "agent",
//               parts: [{ kind: "text", text: agentResponseText }],
//               kind: "message",
//             },
//           },
//           artifacts: [
//             {
//               artifactId,
//               name: `${agentId}Response`,
//               parts: [{ kind: "text", text: agentResponseText }],
//             },
//           ],
//           kind: "task",
//         },
//       });
//     } catch (error) {
//       const errorMessage =
//         error instanceof Error ? error.message : "Internal Error";
//       const errorStack = error instanceof Error ? error.stack : "";
//       console.error("A2A route error:", errorMessage);
//       console.error("Stack:", errorStack);

//       return c.json(
//         {
//           jsonrpc: "2.0",
//           id: null,
//           error: {
//             code: -32603,
//             message: errorMessage,
//             data: { stack: errorStack },
//           },
//         },
//         500
//       );
//     }
//   },
// });

// import { registerApiRoute } from "@mastra/core/server";
// import { randomUUID } from "crypto";
// import { wordAgent } from "./mastra/agents/word-agent.js";

// export const a2aAgentRoute = registerApiRoute("/a2a/agent/:agentId", {
//   method: "POST",
//   handler: async (c) => {
//     try {
//       const mastra = c.get("mastra");
//       const agentId = c.req.param("agentId");

//       // Parse JSON-RPC 2.0 request
//       const body = await c.req.json();
//       const { jsonrpc, id: requestId, method, params } = body;

//       // Validate JSON-RPC 2.0 format
//       if (jsonrpc !== "2.0" || !requestId) {
//         return c.json(
//           {
//             jsonrpc: "2.0",
//             id: requestId || null,
//             error: {
//               code: -32600,
//               message:
//                 'Invalid Request: jsonrpc must be "2.0" and id is required',
//             },
//           },
//           400
//         );
//       }

//       const { message, messages, input, contextId, taskId, metadata } =
//         params || {};

//       // Determine message list
//       let messagesList = [];
//       if (message) {
//         messagesList = [message];
//       } else if (messages && Array.isArray(messages)) {
//         messagesList = messages;
//       }

//       let agentResponseText = "";

//       // Handle wordAgent specifically
//       if (agentId === "wordAgent") {
//         const { action, context, formalityLevel } = input || {};

//         if (!action) {
//           return c.json(
//             {
//               jsonrpc: "2.0",
//               id: requestId,
//               error: {
//                 code: -32602,
//                 message: 'Invalid params: "action" is required in input',
//               },
//             },
//             400
//           );
//         }

//         const prompt = `Please find words for the action "${action}"${
//           context ? ` in the context of "${context}"` : ""
//         }${formalityLevel ? ` with ${formalityLevel} formality level` : ""}.`;

//         try {
//           const response = await wordAgent.generate(prompt);
//           agentResponseText = response.text;
//         } catch (err: any) {
//           throw err;
//         }
//       } else {
//         // Use a Mastra agent if not wordAgent
//         const agent = mastra.getAgent(agentId);
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

//         // Convert messages into Mastra format
//         const mastraMessages = messagesList.map((msg) => ({
//           role: msg.role,
//           content:
//             msg.parts
//               ?.map((part) =>
//                 part.kind === "text"
//                   ? part.text
//                   : part.kind === "data"
//                     ? JSON.stringify(part.data)
//                     : ""
//               )
//               .join("\n") || "",
//         }));

//         const response = await agent.generate(mastraMessages);
//         agentResponseText = response.text || "";
//       }

//       // Build artifacts
//       const artifacts = [
//         {
//           artifactId: randomUUID(),
//           name: `${agentId}Response`,
//           parts: [{ kind: "text", text: agentResponseText }],
//         },
//       ];

//       // Include tool results if available
//       const agent = mastra.getAgent(agentId);
//       const agentResponse = agent && (await agent.generate(messagesList));
//       if (agentResponse?.toolResults?.length > 0) {
//         artifacts.push({
//           artifactId: randomUUID(),
//           name: "ToolResults",
//           parts: agentResponse.toolResults.map((result: any) => ({
//             kind: "data",
//             data: result,
//           })),
//         });
//       }

//       // Conversation history
//       const history = [
//         ...messagesList.map((msg) => ({
//           kind: "message",
//           role: msg.role,
//           parts: msg.parts,
//           messageId: msg.messageId || randomUUID(),
//           taskId: msg.taskId || taskId || randomUUID(),
//         })),
//         {
//           kind: "message",
//           role: "agent",
//           parts: [{ kind: "text", text: agentResponseText }],
//           messageId: randomUUID(),
//           taskId: taskId || randomUUID(),
//         },
//       ];

//       // Return A2A-compliant JSON-RPC response
//       return c.json({
//         jsonrpc: "2.0",
//         id: requestId,
//         result: {
//           id: taskId || randomUUID(),
//           contextId: contextId || randomUUID(),
//           status: {
//             state: "completed",
//             timestamp: new Date().toISOString(),
//             message: {
//               messageId: randomUUID(),
//               role: "agent",
//               parts: [{ kind: "text", text: agentResponseText }],
//               kind: "message",
//             },
//           },
//           artifacts,
//           history,
//           kind: "task",
//         },
//       });
//     } catch (error: any) {
//       console.error("A2A route error:", error.message);
//       return c.json(
//         {
//           jsonrpc: "2.0",
//           id: null,
//           error: {
//             code: -32603,
//             message: "Internal error",
//             data: { details: error.message },
//           },
//         },
//         500
//       );
//     }
//   },
// });
