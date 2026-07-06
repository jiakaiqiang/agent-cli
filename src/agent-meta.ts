export function shouldUseDirectAgentPrompt(instruction: string): boolean {
  const trimmed = instruction.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 120) return false;
  const lower = trimmed.toLowerCase();
  return [
    /你.{0,12}(是什么模型|是哪个模型|什么模型|是谁|是什么)/,
    /(模型|model).{0,12}(是什么|哪个|name|version|id)/i,
    /what (model|are you)|which model|who are you/i,
    /(你的|你).{0,12}(数据|知识|训练数据|上下文)/,
    /(数据|知识|训练数据).{0,12}(来源|截止|到什么时候|是什么|多少|范围)/,
    /training data|knowledge cutoff|data cutoff|context window/i,
  ].some((pattern) => pattern.test(lower));
}
