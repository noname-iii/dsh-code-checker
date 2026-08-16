/**
 * 需求提取：从用户提示词/上下文文本中解析需求条目。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件负责从用户提示词或上下文中提取需求条目，
 * 包括中文停用词过滤与 2-gram 分词、英文关键词提取，以及句子是否为需求描述的判断。
 */
/**
 * 将一句需求文本拆成可搜索的关键词。
 * 中文：去掉停用词后取 2-gram；英文：取长度 >= 3 的单词（过滤常见词）。
 * 中英混合文本两种都提取。
 */
export declare function extractTerms(text: string): string[];
/**
 * 从原始文本中提取需求条目。
 * 先按行/标点切分，保留“像需求”的句子，去重，限制数量。
 */
export declare function extractRequirements(text: string, maxItems?: number): string[];
/** 从消息文本块序列中提取纯文本。 */
export declare function contentText(content: ReadonlyArray<{
    type: string;
    text?: string;
}>): string;
