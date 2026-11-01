const IMAGE_MODEL_PATTERNS = [
  /\bgpt-(?:4o|4[.-][15]|4-(?:turbo|vision)|[56](?:[.-]\d+)*)(?=$|[^a-z0-9])/,
  /\bo(?:1|3)(?=$|[^a-z0-9])(?!-(?:mini|preview)\b)/,
  /\bo4-mini\b/,
  /\bclaude-(?:[345](?:[.-]\d+)*(?:-(?:sonnet|opus|haiku|fable))?|(?:sonnet|opus|haiku|fable)-[345](?:[.-]\d+)*)(?=$|[^a-z0-9])/,
  /\bkimi-(?:k2[.-][567]|k3)(?=$|[^a-z0-9])/,
  /\bkimi-(?:[a-z0-9.-]*-)?(?:vision|vl)(?=$|[^a-z0-9])/,
  /\bqwen(?:[.-]?\d+(?:[.-]\d+)*)?-(?:[a-z0-9.-]*-)?(?:vl|vision|omni)(?=$|[^a-z0-9])/,
  /\bqwen[.-]?3[.-][56]-(?:\d+b|plus|flash)(?=$|[^a-z0-9])/,
  /\bqwen[.-]?3[.-]7-(?:plus|flash)(?=$|[^a-z0-9])/,
  /\bqwen[.-]?3[.-]8-(?:27b|plus|flash|max)(?=$|[^a-z0-9])/,
  /\bglm-[45](?:[.-]\d+)*v(?=$|[^a-z0-9])/,
  /\bglm-5[.-]3-flashx?(?=$|[^a-z0-9])/,
  /\bdeepseek-(?:[a-z0-9.-]*-)?(?:vl\d*|vision|ocr)(?=$|[^a-z0-9])/,
  /\bdeepseek-(?:v4[.-]1-flash|flash)(?=$|[^a-z0-9])/,
  /\bmi[mn]o-v2-(?:vl|vision|omni)(?=$|[^a-z0-9])/,
  /\bmi[mn]o-v2[.-]5(?=$|[^a-z0-9])(?!-pro\b)/,
  /\bmi[mn]o-v2[.-]6-(?:flash|pro)(?=$|[^a-z0-9])/,
  /\bminimax-(?:m3|vl-?01)(?=$|[^a-z0-9])/,
  /\bgemini-(?:1[.-]5|[23](?:[.-]\d+)*|1[.-]0-pro-vision)(?=$|[^a-z0-9])/,
  /\bpixtral-(?:12b|large)(?=$|[^a-z0-9])/,
  /\bllama-[34](?:[.-]\d+)*-(?:[a-z0-9.-]*-)?vision(?=$|[^a-z0-9])/
];

export function defaultModelInput(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim().toLowerCase().replaceAll('_', '-') : '';
  // These variants can share a vision model's family name without image input.
  const textOnly = /\b(?:embedding\w*|rerank\w*|audio|tts|transcrib\w*|text-only)\b/.test(id)
    || /\bqwen[^/]*\b(?:coder|text)\b/.test(id);
  return !textOnly && IMAGE_MODEL_PATTERNS.some((pattern) => pattern.test(id)) ? ['text', 'image'] : ['text'];
}

export function withDefaultModelInput(model, field = 'input') {
  return Array.isArray(model[field]) && model[field].length > 0
    ? model
    : { ...model, [field]: defaultModelInput(model.id) };
}
