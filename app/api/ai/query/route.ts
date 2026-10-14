import { NextRequest, NextResponse } from "next/server";
import { checkHasActiveGrant } from "@/lib/monad";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { docId, question, passages, agentAddress } = body;

    if (!docId || !question || !passages || !Array.isArray(passages) || !agentAddress) {
      return NextResponse.json(
        { error: "Invalid request payload. Required: docId, question, passages array, and agentAddress." },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // CRITICAL SECURITY REQUIREMENT:
    // Server-side independent validation of Monad onchain permission
    // BEFORE invoking the AI provider model.
    // ------------------------------------------------------------------
    const permissionStatus = await checkHasActiveGrant(docId, agentAddress);

    if (!permissionStatus.active) {
      return NextResponse.json(
        {
          error: "Permission Denied: Monad onchain grant check failed. The grant for this AI agent is either revoked, expired, or non-existent.",
          permissionStatus,
        },
        { status: 403 }
      );
    }

    // Check AI provider API key configuration
    const apiKey = process.env.AI_API_KEY;
    const providerUrl = process.env.AI_PROVIDER_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
    const modelName = process.env.AI_MODEL_NAME || "gemini-2.5-flash";

    if (!apiKey || apiKey.includes("your_llm_api_key_here")) {
      return NextResponse.json(
        {
          error: "AI Provider Configuration Missing: The server environment variable `AI_API_KEY` is not set. Please add `AI_API_KEY` to your `.env.local` file to enable live LLM integration.",
          isConfigError: true,
          permissionStatus,
          citedPassages: passages.slice(0, 3),
        },
        { status: 200 }
      );
    }

    // Build system & user prompts
    const formattedPassages = passages
      .map((p: string, idx: number) => `[Passage ${idx + 1}]: ${p}`)
      .join("\n\n");

    const systemPrompt = `You are VaultMind AI Assistant. Answer the user's question accurately using ONLY the provided document passages. Cite the passages you rely on (e.g. [Passage 1]).`;
    const userPrompt = `Document Passages:\n${formattedPassages}\n\nUser Question:\n${question}`;

    const endpoint = `${providerUrl.replace(/\/$/, "")}/chat/completions`;

    // Standard Bearer auth works for OpenAI, Gemini OpenAI-compat, Kimi, and Qwen
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };

    const aiRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return NextResponse.json(
        {
          error: `AI Provider HTTP Error (${aiRes.status}): ${errText}`,
          permissionStatus,
        },
        { status: 502 }
      );
    }

    const data = await aiRes.json();
    const answer = data.choices?.[0]?.message?.content || "No answer returned by model.";

    return NextResponse.json({
      answer,
      permissionStatus,
      citedPassages: passages,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Server error processing AI question: ${err?.message || err}` },
      { status: 500 }
    );
  }
}
