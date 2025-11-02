import { z } from "zod";
import { createToolCallAccuracyScorerCode } from "@mastra/evals/scorers/code";
import { createCompletenessScorer } from "@mastra/evals/scorers/code";
import { createScorer } from "@mastra/core/scores";

export const toolCallAppropriatenessScorer = createToolCallAccuracyScorerCode({
  expectedTool: "wordTool",
  strictMode: false,
});

export const completenessScorer = createCompletenessScorer();

// Custom LLM-judged scorer: evaluates if word suggestions align with the provided context
export const contextAlignmentScorer = createScorer({
  name: "Context Alignment",
  description:
    "Checks that suggested words appropriately match the specified context (e.g., professional, creative, casual)",
  type: "agent",
  judge: {
    model: "google/gemini-2.5-pro",
    instructions:
      "You are an expert evaluator of linguistic appropriateness and context alignment. " +
      "Determine whether the word suggestions provided by the assistant match the context specified by the user. " +
      "Consider formality level, tone, and appropriateness for the stated use case. " +
      "Be strict about formal contexts but lenient with creative or casual contexts. " +
      "Return only the structured JSON matching the provided schema.",
  },
})
  .preprocess(({ run }) => {
    const userText = (run.input?.inputMessages?.[0]?.content as string) || "";
    const assistantText = (run.output?.[0]?.content as string) || "";
    return { userText, assistantText };
  })
  .analyze({
    description:
      "Evaluate if word suggestions match the specified context and formality level",
    outputSchema: z.object({
      contextProvided: z.boolean(),
      contextType: z.string().optional(),
      aligned: z.boolean(),
      confidence: z.number().min(0).max(1).default(1),
      explanation: z.string().default(""),
    }),
    createPrompt: ({ results }) => `
      You are evaluating if a word generator assistant correctly provided words that match the user's context.
      
      User text:
      """
      ${results.preprocessStepResult.userText}
      """
      
      Assistant response:
      """
      ${results.preprocessStepResult.assistantText}
      """
      
      Tasks:
      1) Identify if the user specified a particular context (e.g., "professional email", "creative writing", "casual conversation")
      2) If a context was specified, evaluate whether the suggested words are appropriate for that context
      3) Check if formal words are suggested for formal contexts, casual words for casual contexts, etc.
      4) Assess if the words would actually work well in the specified use case
      
      Return JSON with fields:
      {
        "contextProvided": boolean,
        "contextType": string (optional, e.g., "professional", "creative", "casual"),
        "aligned": boolean (true if suggestions match context),
        "confidence": number, // 0-1
        "explanation": string
      }
    `,
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    if (!r.contextProvided) return 1; // If no context specified, full credit
    if (r.aligned) {
      // High alignment: 0.8-1.0 based on confidence
      return Math.max(0.8, Math.min(1, 0.8 + 0.2 * (r.confidence ?? 1)));
    }
    // Poor alignment: 0-0.5 based on confidence
    return Math.max(0, Math.min(0.5, 0.5 * (r.confidence ?? 0)));
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    return `Context alignment scoring: contextProvided=${r.contextProvided ?? false}, contextType=${r.contextType ?? "none"}, aligned=${r.aligned ?? false}, confidence=${r.confidence ?? 0}. Score=${score}. ${r.explanation ?? ""}`;
  });

export const scorers = {
  toolCallAppropriatenessScorer,
  completenessScorer,
  contextAlignmentScorer,
};
