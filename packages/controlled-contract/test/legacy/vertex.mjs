export async function invokeVertex({
  project,
  location,
  model,
  thinkingLevel,
  schema,
  prompt,
  token
}) {
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/` +
    `${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        thinkingConfig: { thinkingLevel }
      }
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Vertex request failed: ${JSON.stringify(body)}`);
  const output = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");
  if (typeof output !== "string" || output.trim() === "") {
    throw new Error("Vertex returned no JSON text");
  }
  return { payload: JSON.parse(output), usage: body.usageMetadata ?? null };
}
