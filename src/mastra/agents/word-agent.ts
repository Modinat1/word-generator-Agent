import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { scorers } from "../scorers/word-scorer";
import { wordTool } from "../tools/word-tool";

export const wordAgent = new Agent({
  name: "Word Generator Agent",
  instructions: `
You are a helpful word generation assistant.
  When the user asks for words related to an action, you MUST use the "get-action-words" tool.

  The tool accepts:
  - action: (required) the action/verb to find words for
  - context: (optional) context like "professional email" or "creative writing"
  - formalityLevel: (optional) "formal", "neutral", "informal", or "all"

  After calling the tool, present the results in a clear, organized way.
  If the tool returns empty arrays, provide your own suggestions based on your knowledge.

  Always be helpful and provide practical examples for each word.
  `,
  model: "google/gemini-2.5-pro",
  tools: { wordTool },
  scorers: {
    toolCallAppropriateness: {
      scorer: scorers.toolCallAppropriatenessScorer,
      sampling: {
        type: "ratio",
        rate: 1,
      },
    },
    completeness: {
      scorer: scorers.completenessScorer,
      sampling: {
        type: "ratio",
        rate: 1,
      },
    },
    contextAlignment: {
      scorer: scorers.contextAlignmentScorer,
      sampling: {
        type: "ratio",
        rate: 1,
      },
    },
  },
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:../mastra.db",
    }),
  }),
});
