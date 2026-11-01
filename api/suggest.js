// Vercel serverless function: POST /api/suggest
// Takes the visitor's choices and asks Groq (an OpenAI-compatible chat API) for fresh
// gift ideas, returning them in the same shape the front-end's curated bank uses, so
// the page can render AI and curated cards through one renderer.
//
// GROQ_API_KEY must be set as a Vercel Environment Variable (Project Settings ->
// Environment Variables). It is never read from, or exposed to, the client.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Backend not configured yet — front-end treats this as "AI unavailable" and
    // falls back to its curated list, so this is a quiet, expected state pre-launch.
    res.status(503).json({ error: "groq_not_configured" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    res.status(400).json({ error: "bad_json" });
    return;
  }

  const occasion = String(body.occasion || "").slice(0, 60);
  const relation = String(body.relation || "").slice(0, 60);
  const age = String(body.age || "").slice(0, 60);
  const budget = String(body.budget || "").slice(0, 60);
  const lang = body.lang === "en" ? "en" : "hi";
  const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 40).map(String) : [];
  const count = Math.min(Math.max(Number(body.count) || 4, 1), 6);

  if (!occasion || !relation || !budget) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  const langName = lang === "en" ? "English" : "Hindi (Devanagari script)";
  const excludeLine = exclude.length
    ? `Do not repeat any of these already-shown gifts, and do not suggest close variants of them either: ${exclude.join(", ")}.`
    : "";

  // A random seed, never shown to the model as meaningful data, forces a fresh sample
  // each call instead of the model latching onto its single most "obvious" answer for
  // a given occasion/relation/budget combination (which otherwise looks "copied" when
  // the same choices are picked twice in a row).
  const seed = Math.random().toString(36).slice(2, 10);

  const prompt =
    `You are a gift-recommendation assistant for an Indian gifting website called GiftGenie.\n` +
    `Occasion: ${occasion}\n` +
    `Recipient relation: ${relation}\n` +
    `Recipient age group: ${age}\n` +
    `Budget: ${budget}\n` +
    `${excludeLine}\n` +
    `Suggest ${count} specific, realistic, purchasable gift ideas available in India (things sold on ` +
    `Amazon.in, Flipkart or Meesho), suited to this occasion, relation, age and budget.\n` +
    `Vary your picks across different categories (food/sweets, accessories, home decor, tech, experience, ` +
    `clothing, personal care, etc.) rather than giving the single most generic answer for each category. ` +
    `Randomisation seed (ignore its value, just use it to pick a different angle than usual): ${seed}.\n` +
    `Respond with ONLY a JSON object, no markdown fences, no extra text, in exactly this shape:\n` +
    `{"suggestions":[{"name":"short gift name","desc":"one short sentence, why it fits","tags":["tag1","tag2"],"emoji":"single emoji"}]}\n` +
    `Write "name", "desc" and "tags" in ${langName}. Keep "name" under 60 characters and "desc" under 140 characters.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 1.1,
        top_p: 0.95,
        max_tokens: 700,
        response_format: { type: "json_object" }
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => "");
      res.status(502).json({ error: "groq_error", detail: errText.slice(0, 300) });
      return;
    }

    const data = await groqRes.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      res.status(502).json({ error: "empty_groq_response" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      res.status(502).json({ error: "unparseable_groq_response" });
      return;
    }

    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, count) : [];
    res.status(200).json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: "server_error", detail: String(err && err.message || err).slice(0, 300) });
  }
};
