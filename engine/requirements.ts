/**
 * 需求提取：从用户提示词/上下文文本中解析需求条目。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件负责从用户提示词或上下文中提取需求条目，
 * 包括中文停用词过滤与 2-gram 分词、英文关键词提取，以及句子是否为需求描述的判断。
 */

/** 中文常见停用词（用于分词时的噪音过滤）。 */
const ZH_STOPWORDS = new Set([ // 定义中文停用词集合
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '及', '或', // 单字虚词 / 代词 / 连词
  '一个', '这个', '那个', '这些', '那些', '需要', '实现', '功能', '支持', '可以', '应该', // 常见功能与情态词
  '能够', '进行', '以及', '等', '有', '没有', '中', '上', '下', '要', '把', '被', '让', // 常见动词 / 方位词
  '对', '为', '请', '做', '添加', '增加', '使用', '通过', '按照', '如果', '所有', '全部', // 常见指令 / 条件词
  '一些', '可能', '其他', '主要', '包括', '并且', '然后', '或者', '还是', '就', '都', '也', // 常见副词 / 连词
  '更', '最', '很', '还', '只', '才', '而', '但', '因为', '所以', '这样', '那样', '怎么', // 程度副词 / 因果连词
  '什么', '如何', '为什么', '是否', '能否', '关于', '对于', '根据', '由于', '为了', '作为', // 疑问词 / 介词
  '从', '向', '在', '当', '之', '其', '此', '该', '这', '那', '个', '种', '次', '年', '月', // 介词 / 指示词 / 量词 / 时间单位
  '日', '时', '分', '秒', '元', '块', '角', '分', '钱', '里', '内', '外', '前', '后', '左', // 时间 / 货币 / 方位单位
  '右', '本', '各', '每', '几', '些', '你', '您', '给', '帮我', '麻烦', '希望', '要求', '想', // 方位 / 数量 / 敬语 / 意愿词
  '用', '一个', '一款', '一套', '一下', '一些', '一份', '一种', '目前', '现在', '然后', '最后', // 量词 / 时间词
  '例如', '比如', '同时', '另外', '此外', '其中', '其中', '此外', '当然', '特别', '尤其', // 举例 / 连接 / 强调词
  '这里', '那里', '以上', '以下', '如下', '这样', '那样', '如此', '什么', '谁', '哪里', // 指示 / 疑问词
  '何时', '为何', '哪些', '每个', '某个', '任何', '不', '没', '别', '无', '非', '未', // 疑问 / 否定词
]) // 停用词集合定义结束

/** 判断字符是否属于 CJK 统一表意文字。 */
function isCjk(ch: string): boolean { // 判断单个字符是否属于中日韩统一表意文字
  const code = ch.codePointAt(0) ?? 0 // 取字符的 Unicode 码点，取不到则为 0
  return (code >= 0x4E00 && code <= 0x9FFF) // 基本汉字区
    || (code >= 0x3400 && code <= 0x4DBF) // 扩展 A 区
    || (code >= 0xF900 && code <= 0xFAFF) // 兼容表意文字区
}

/** 文本中是否含中文。 */
function hasCjk(text: string): boolean { // 判断文本中是否包含中文
  return [...text].some(isCjk) // 将文本按码点展开，判断是否有任一字符为中文
}

/** 英文常见停用词（常见虚词 / 助动词 / 代词等）。 */
const EN_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'are', 'was', 'will', 'can', 'should', 'must', 'need', 'want', 'please', 'make', 'made', 'using', 'user', 'users', 'app', 'application', 'project', 'code', 'file', 'files', 'system', 'data', 'which', 'what', 'when', 'where', 'your', 'you', 'not', 'all', 'any', 'each', 'some', 'into', 'onto', 'its', 'their', 'they', 'there', 'here', 'then', 'than', 'also', 'such', 'only', 'just', 'like', 'would', 'could', 'about', 'other', 'another']) // 定义英文停用词集合，用于过滤英文关键词中的常见虚词

/**
 * 将一句需求文本拆成可搜索的关键词。
 * 中文：去掉停用词后取 2-gram；英文：取长度 >= 3 的单词（过滤常见词）。
 * 中英混合文本两种都提取。
 */
export function extractTerms(text: string): string[] { // 从需求文本中提取可搜索关键词
  const terms: string[] = [] // 初始化关键词结果数组
  if (hasCjk(text)) { // 若文本包含中文
    // 去掉停用词与标点
    const chars = [...text].filter(ch => !/[\s，。！？；：、“”‘’（）()\[\]{}<>《》—…·,.;:!?'"~#%&*+=|\\\/\-]/.test(ch) && ch !== undefined) // 过滤空白、标点与 undefined，得到纯字符数组
    const filtered: string[] = [] // 初始化去停用词后的字符数组
    for (const ch of chars) { // 遍历每个字符
      if (ch && ZH_STOPWORDS.has(ch)) continue // 字符属于停用词则跳过
      filtered.push(ch) // 非停用词字符加入数组
    }
    // 2-gram
    const joined = filtered.join('') // 将去停用词后的字符拼接成字符串
    for (let i = 0; i + 1 < joined.length; i++) { // 遍历生成相邻双字符组合
      const bigram = joined.slice(i, i + 2) // 截取相邻两个字符作为 2-gram
      if (!terms.includes(bigram)) terms.push(bigram) // 去重后加入关键词
    }
  }
  // 英文单词（无论是否含中文都提取，覆盖中英混合需求）
  const words = text.toLowerCase().split(/[^a-z0-9_]+/).filter(w => w.length >= 3 && !EN_STOP.has(w)) // 转小写后按非字母数字下划线切分，保留长度 >= 3 且非停用词的单词
  for (const w of words) if (!terms.includes(w)) terms.push(w) // 将去重后的英文单词加入关键词
  return terms.slice(0, 40) // 最多返回前 40 个关键词
}

/** 判断一句话是否像需求描述（过滤纯寒暄/询问）。 */
function looksLikeRequirement(text: string): boolean { // 判断一句话是否像需求描述
  const t = text.trim() // 去除首尾空白
  if (t.length < 4 || t.length > 600) return false // 长度过短或过长都不视为需求
  // 过滤纯提问寒暄
  if (/^(你好|您好|hi|hello|hey|谢谢|thanks|ok|好的|明白|收到)[，。!！?？\s]*$/i.test(t)) return false // 纯寒暄 / 致谢语句不视为需求
  // 过滤“纯提问句”：带疑问词且以问号/吗/呢结尾，同时不含任何明确需求动词的句子
  // （例如“那么我现在还要重新下载吗？”是提问不是功能需求；“能支持导出CSV吗？”含“支持”仍是需求）
  const questionWord = /吗|呢|为什么|怎么|如何|什么|是否|能否|难道|干嘛|哪里|哪个|何时|为何|哪些|谁/ // 疑问词集合
  const demandVerb = /实现|支持|添加|增加|修改|修复|请|帮我|需要|必须|应该|要求|希望|提交|发布|生成|创建|编写|设计|开发|接入|部署|构建|打包|测试|安装|处理|适配|兼容|允许|提供|展示|显示/ // 明确需求动词集合（不含“下载/上传”等名词性动作，避免“还要重新下载吗”这类提问被保留）
  if (questionWord.test(t) && /[？?吗呢]$/.test(t) && !demandVerb.test(t)) return false // 纯提问句（疑问词 + 疑问结尾 + 无需求动词）→ 不是需求
  // 含行为动词或特征词
  if (/实现|开发|编写|创建|添加|增加|支持|提供|展示|显示|允许|需要|要求|包含|具备|能够|可以|应该|设计|制作|生成|绘制|渲染|接入|对接|集成|部署|构建|打包|测试|修改|修复|提交|发布|安装|处理|适配|兼容|调整|改进|优化|重构|更新|升级|配置|验证|检查|清理|移除|替换|增强|简化|迁移|校验|make|build|create|add|support|implement|show|display|render|include|provide|allow|require|should|must|need|develop|write|design/i.test(t)) { // 若包含行为动词或特征词
    return true // 判定为需求
  }
  // 或包含功能名词短语（含“功能/页面/按钮/接口/模块/系统”等）
  if (/功能|页面|界面|按钮|接口|模块|系统|应用|程序|软件|工具|组件|表单|列表|搜索|登录|注册|上传|下载|导出|导入|保存|删除|编辑|图表|报表|菜单|窗口|数据库|文件|api|button|page|screen|form|list|search|login|register|upload|download|export|import|save|delete|edit|chart|report|menu|window|database/i.test(t)) { // 若包含功能名词短语
    return true // 判定为需求
  }
  return false // 否则不视为需求
}

/**
 * 从原始文本中提取需求条目。
 * 先按行/标点切分，保留“像需求”的句子，去重，限制数量。
 */
export function extractRequirements(text: string, maxItems = 200): string[] { // 从原始文本提取需求条目（默认最多 200 条）
  if (!text) return [] // 空文本直接返回空数组
  // 按行切，行内再按中英文句末标点切。
  // 注意：(?!\d) 防止把“v0.2.2”“3.14”等数字中的小数点当成句末标点切开。
  const raw: string[] = [] // 初始化按句切分的结果数组
  for (const line of text.split(/\r?\n/)) { // 按换行符切分文本并遍历每一行
    const pieces = line // 对当前行进行切分
      .split(/(?<=[。！？；.!?;])(?!\d)/) // 按中英文句末标点切分（保留标点；标点后紧跟数字时不切，避免切开版本号/小数）
      .map(p => p.trim()) // 去除每段首尾空白
      .filter(p => p.length > 0) // 过滤空段
    raw.push(...pieces) // 将切分出的片段展开加入 raw
  }
  // 若某行以列表符号开头，也整体保留
  const bullets = text.split(/\r?\n/).filter(l => /^\s*(?:[-*•·]|\d+[.、)])/.test(l.trim()) && l.trim().length > 4) // 提取以列表符号或数字编号开头且内容较长（>4）的行

  const seen = new Set<string>() // 用于去重的已见集合
  const out: string[] = [] // 最终需求条目数组
  const push = (item: string): void => { // 内部函数：清洗、去重后加入结果
    const t = item.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').trim() // 去除行首列表符号 / 编号并修剪空白
    if (!t || seen.has(t)) return // 空内容或已存在则跳过
    if (!looksLikeRequirement(t)) return // 不像需求描述则跳过
    seen.add(t) // 记录已见
    out.push(t) // 加入结果数组
  }
  for (const b of bullets) push(b) // 先处理列表行
  for (const piece of raw) push(piece) // 再处理按句切分的片段
  return out.slice(0, maxItems) // 最多返回 maxItems 条
}

/** 从消息文本块序列中提取纯文本。 */
export function contentText(content: ReadonlyArray<{ type: string; text?: string }>): string { // 从消息块数组中提取纯文本内容
  let text = '' // 初始化拼接文本
  for (const block of content) { // 遍历每个消息块
    if (block.type === 'text' && typeof block.text === 'string') text += block.text + '\n' // 仅拼接 text 类型块内容，并追加换行
  }
  return text.trim() // 返回去除首尾空白后的文本
}
