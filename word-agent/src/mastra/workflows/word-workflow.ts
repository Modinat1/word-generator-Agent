import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

const wordSuggestionSchema = z.object({
  word: z.string(),
  usage: z.string(),
  example: z.string().optional(),
});

const wordResponseSchema = z.object({
  action: z.string(),
  analysis: z.string(),
  primaryWords: z.array(wordSuggestionSchema),
  formal: z.array(wordSuggestionSchema),
  informal: z.array(wordSuggestionSchema),
  creative: z.array(wordSuggestionSchema),
  contextSpecific: z.string().optional(),
});

const fetchWords = createStep({
  id: "fetch-words",
  description: "Fetches word suggestions for a given action",
  inputSchema: z.object({
    action: z.string().describe("The action to get words for"),
    context: z.string().optional().describe("Optional context for word usage"),
    formalityLevel: z.enum(["formal", "neutral", "informal", "all"]).optional(),
  }),
  outputSchema: wordResponseSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    // This would typically call your word tool or API
    // For demonstration, returning a structured response
    const wordData: z.infer<typeof wordResponseSchema> = {
      action: inputData.action,
      analysis: `Analyzing the action "${inputData.action}"${inputData.context ? ` in the context of ${inputData.context}` : ""}`,
      primaryWords: [
        {
          word: inputData.action,
          usage: "Base form of the action",
          example: `I ${inputData.action} every day.`,
        },
      ],
      formal: [],
      informal: [],
      creative: [],
      contextSpecific: inputData.context,
    };

    return wordData;
  },
});

const enhanceWords = createStep({
  id: "enhance-words",
  description: "Enhances word suggestions using the word agent",
  inputSchema: wordResponseSchema,
  outputSchema: z.object({
    suggestions: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const wordData = inputData;

    if (!wordData) {
      throw new Error("Word data not found");
    }

    const agent = mastra?.getAgent("wordAgent");
    if (!agent) {
      throw new Error("Word agent not found");
    }

    const prompt = `Based on the action "${wordData.action}", provide comprehensive word suggestions:
      ${wordData.contextSpecific ? `Context: ${wordData.contextSpecific}` : ""}
      
      Structure your response exactly as follows:

      🎯 ACTION: ${wordData.action}
      ═══════════════════════════

      📝 ANALYSIS
      ${wordData.analysis}

      ✨ PRIMARY SUGGESTIONS
      These are the most common and versatile words:
      
      ${wordData.primaryWords.length > 0 ? wordData.primaryWords.map((w) => `• ${w.word} - ${w.usage}${w.example ? `\n  Example: "${w.example}"` : ""}`).join("\n") : "(Provide 3-5 primary word suggestions with usage and examples)"}

      🎩 FORMAL ALTERNATIVES
      Professional and sophisticated vocabulary:
      
      (Provide 3-5 formal alternatives with:
      • Word - Usage context
        Example: "[example sentence]"
        Best for: [specific formal contexts])

      💬 INFORMAL ALTERNATIVES
      Casual and conversational options:
      
      (Provide 3-5 informal alternatives with:
      • Word - Usage context
        Example: "[example sentence]"
        Best for: [specific casual contexts])

      🎨 CREATIVE ALTERNATIVES
      Vivid, descriptive, or literary choices:
      
      (Provide 3-5 creative alternatives with:
      • Word - Nuance and tone
        Example: "[example sentence]"
        Effect: [emotional or stylistic impact])

      ${wordData.contextSpecific ? `\n🎯 CONTEXT-SPECIFIC RECOMMENDATIONS\n(Provide tailored suggestions for: ${wordData.contextSpecific})` : ""}

      ⚡ USAGE TIPS
      • [Quick tip about choosing between options]
      • [Tip about common mistakes or considerations]
      • [Tip about tone or connotation differences]

      Guidelines:
      - Provide at least 3 suggestions per category
      - Include practical examples for each word
      - Explain subtle differences in meaning or tone
      - Consider the formality level if specified
      - Make suggestions specific to any context provided
      - Highlight words that work best for the stated purpose

      Maintain this exact formatting for consistency, using the emoji and section headers as shown.`;

    const response = await agent.stream([
      {
        role: "user",
        content: prompt,
      },
    ]);

    let suggestionsText = "";

    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      suggestionsText += chunk;
    }

    return {
      suggestions: suggestionsText,
    };
  },
});

const wordWorkflow = createWorkflow({
  id: "word-workflow",
  inputSchema: z.object({
    action: z.string().describe("The action to get words for"),
    context: z.string().optional().describe("Optional context for word usage"),
    formalityLevel: z.enum(["formal", "neutral", "informal", "all"]).optional(),
  }),
  outputSchema: z.object({
    suggestions: z.string(),
  }),
})
  .then(fetchWords)
  .then(enhanceWords);

wordWorkflow.commit();

export { wordWorkflow };
