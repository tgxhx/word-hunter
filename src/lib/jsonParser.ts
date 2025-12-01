/**
 * JSON 和自然语言解析工具库
 * 用于处理 OpenAI 响应的各种格式，提供容错机制
 */

export interface ParsedWordData {
  word?: string
  main_title?: string
  sections?: {
    common_meanings?: {
      title_template?: string
      items?: Array<{ definition: string } | string>
    }
    context_analysis?: {
      title: string
      sentence: string
      analysis: string
    }
    similar_words?: {
      title: string
      items?: Array<{ english: string; chinese: string }>
    }
  }
  // 用于存储非结构化解析的结果
  fallback_content?: {
    meanings?: string[]
    context_analysis?: string
    similar_words?: Array<{ english: string; chinese: string }>
  }
}

export interface ParseResult {
  success: boolean
  data: ParsedWordData
  parse_method: 'json_strict' | 'json_repaired' | 'natural_language' | 'raw_text'
  error?: string
  debug_info?: string
}

/**
 * 智能提取 JSON 内容
 * 使用大括号平衡算法，避免贪婪匹配的问题
 */
function extractJsonSmart(text: string): string | null {
  // 先尝试找到 JSON 对象
  let braceCount = 0
  let startIndex = -1

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '{') {
      if (braceCount === 0) {
        startIndex = i
      }
      braceCount++
    } else if (char === '}') {
      braceCount--
      if (braceCount === 0 && startIndex !== -1) {
        // 找到了完整的JSON对象
        return text.substring(startIndex, i + 1)
      }
    }
  }

  // 如果没找到对象，尝试数组
  let bracketCount = 0
  startIndex = -1

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '[') {
      if (bracketCount === 0) {
        startIndex = i
      }
      bracketCount++
    } else if (char === ']') {
      bracketCount--
      if (bracketCount === 0 && startIndex !== -1) {
        // 找到了完整的JSON数组
        return text.substring(startIndex, i + 1)
      }
    }
  }

  return null
}

/**
 * 智能修复 JSON 中的引号问题
 * 使用状态机来处理复杂的字符串值，包括包含双引号的情况
 */
function smartQuoteRepair(text: string): string {
  let result = ''
  let i = 0
  let inString = false
  let stringStartChar = '"'

  while (i < text.length) {
    const char = text[i]
    const nextChar = text[i + 1]
    const prevChar = text[i - 1]

    // 处理字符串开始/结束
    if (char === '"' && (i === 0 || prevChar !== '\\')) {
      inString = !inString
      result += char
      i++
      continue
    }

    // 如果在字符串中，直接添加字符（处理转义）
    if (inString) {
      result += char
      i++
      continue
    }

    // 处理键名修复
    if (char.match(/\w/) && (i === 0 || text[i - 1].match(/[\s,{[]/))) {
      let keyEnd = i
      while (keyEnd < text.length && text[keyEnd].match(/\w/)) {
        keyEnd++
      }

      if (keyEnd < text.length && text[keyEnd] === ':') {
        // 找到了一个没有引号的键名
        const key = text.substring(i, keyEnd)
        result += `"${key}"`
        i = keyEnd
        continue
      }
    }

    // 处理键值对中的值
    if (char === ':') {
      result += ':'
      i++

      // 跳过空格
      while (i < text.length && text[i].match(/\s/)) {
        result += text[i]
        i++
      }

      const valueStart = i
      if (valueStart >= text.length) break

      const valueChar = text[valueStart]

      // 如果值已经是正确格式的字符串
      if (valueChar === '"' || valueChar === '{' || valueChar === '[' ||
        valueChar === 't' || valueChar === 'f' || valueChar === 'n' ||
        valueChar.match(/\d/)) {

        // 检查是否是未闭合的字符串
        if (valueChar === '"') {
          let stringEnd = valueStart + 1
          let hasClosingQuote = false

          while (stringEnd < text.length) {
            if (text[stringEnd] === '"' && text[stringEnd - 1] !== '\\') {
              hasClosingQuote = true
              break
            }
            stringEnd++
          }

          if (hasClosingQuote) {
            // 字符串格式正确，直接添加
            while (i < stringEnd + 1) {
              result += text[i]
              i++
            }
            continue
          }
        }

        // 其他格式（数字、布尔值、null、对象、数组）
        // 查找值的结束位置
        let valueEnd = valueStart
        let braceCount = 0
        let bracketCount = 0
        let inStringValue = false

        while (valueEnd < text.length) {
          const currentChar = text[valueEnd]

          if (currentChar === '"' && (valueEnd === 0 || text[valueEnd - 1] !== '\\')) {
            inStringValue = !inStringValue
          } else if (!inStringValue) {
            if (currentChar === '{') braceCount++
            else if (currentChar === '}') braceCount--
            else if (currentChar === '[') bracketCount++
            else if (currentChar === ']') bracketCount--
            else if ((currentChar === ',' || currentChar === '}' || currentChar === ']') &&
              braceCount === 0 && bracketCount === 0) {
              break
            }
          }
          valueEnd++
        }

        // 添加值
        while (i < valueEnd) {
          result += text[i]
          i++
        }
      } else {
        // 需要为值添加引号
        let valueEnd = valueStart
        let braceCount = 0
        let bracketCount = 0
        let inStringValue = false

        while (valueEnd < text.length) {
          const currentChar = text[valueEnd]

          if (currentChar === '"' && (valueEnd === 0 || text[valueEnd - 1] !== '\\')) {
            inStringValue = !inStringValue
          } else if (!inStringValue) {
            if (currentChar === '{') braceCount++
            else if (currentChar === '}') braceCount--
            else if (currentChar === '[') bracketCount++
            else if (currentChar === ']') bracketCount--
            else if ((currentChar === ',' || currentChar === '}' || currentChar === ']') &&
              braceCount === 0 && bracketCount === 0) {
              break
            }
          }
          valueEnd++
        }

        const value = text.substring(valueStart, valueEnd).trim()

        // 转义值中的双引号
        const escapedValue = value.replace(/"/g, '\\"')
        result += `"${escapedValue}"`
        i = valueEnd
      }
      continue
    }

    // 其他情况直接添加字符
    result += char
    i++
  }

  return result
}

/**
 * 增强的 JSON 解析器
 * 1. 尝试标准 JSON 解析
 * 2. 智能提取 JSON 内容并解析
 * 3. 智能修复常见格式错误后解析
 */
function enhancedJsonParse(text: string): { success: boolean; data?: any; error?: string; repaired?: boolean } {
  // 第一次尝试：标准 JSON 解析
  try {
    const data = JSON.parse(text)
    return { success: true, data, repaired: false }
  } catch (error) {
    console.debug('[Parser] Standard JSON parse failed:', error)
  }

  // 第二次尝试：智能提取 JSON 内容
  let extractedJson = extractJsonSmart(text)
  if (extractedJson) {
    console.debug('[Parser] Extracted JSON:', extractedJson)

    try {
      const data = JSON.parse(extractedJson)
      return { success: true, data, repaired: true }
    } catch (error) {
      console.debug('[Parser] Extracted JSON parse failed:', error)
    }
  }

  // 第三次尝试：智能修复常见格式错误
  let repairedText = extractedJson || text

  // 基础修复
  repairedText = repairedText
    // 去除代码块包裹
    .replace(/```(?:json)?\s*/g, '')
    .replace(/\s*```$/g, '')
    // 修复多余的大括号（在末尾）
    .replace(/\}+(\s*$)/g, '}$1')
    // 修复多余的大括号（在开头）
    .replace(/^(\s*)\{+/g, '$1{')
    // 去除前后多余空白字符
    .trim()

  // 智能修复引号问题
  repairedText = smartQuoteRepair(repairedText)

  // 其他修复
  repairedText = repairedText
    // 修复多余的逗号
    .replace(/,(\s*[}\]])/g, '$1')
    // 修复换行符问题（只修复字符串外的换行）
    .replace(/\n/g, '\\n')
    // 修复制表符问题
    .replace(/\t/g, '\\t')

  try {
    const data = JSON.parse(repairedText)
    return { success: true, data, repaired: true }
  } catch (error) {
    console.debug('[Parser] Repaired JSON parse failed:', error)
    console.debug('[Parser] Repaired text:', repairedText)
  }

  return { success: false, error: 'Unable to parse JSON even after repairs' }
}

/**
 * 自然语言解析器
 * 从非结构化文本中提取关键信息
 */
function naturalLanguageParse(text: string, word: string): ParsedWordData {
  const result: ParsedWordData = {
    word,
    fallback_content: {
      meanings: [],
      context_analysis: '',
      similar_words: []
    }
  }

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)

  let currentSection = 'meanings'
  let hasContextSection = false
  let hasSimilarWordsSection = false

  for (const line of lines) {
    // 识别不同部分
    if (line.match(/含义|意思|定义|翻译|meaning|definition/i)) {
      currentSection = 'meanings'
      continue
    } else if (line.match(/语境|上下文|句子|context|sentence/i)) {
      currentSection = 'context'
      hasContextSection = true
      continue
    } else if (line.match(/近义|相似|similar|synonym/i)) {
      currentSection = 'similar_words'
      hasSimilarWordsSection = true
      continue
    }

    // 提取内容
    if (currentSection === 'meanings') {
      // 提取含义（以数字或项目符号开头的行）
      if (line.match(/^[\d\-\*\•]\s*/)) {
        const meaning = line.replace(/^[\d\-\*\•]\s*/, '').replace(/^\.\s*/, '')
        if (meaning && !result.fallback_content!.meanings.includes(meaning)) {
          result.fallback_content!.meanings.push(meaning)
        }
      }
    } else if (currentSection === 'context' && hasContextSection) {
      // 提取语境分析
      if (line.length > 10 && !line.match(/语境|上下文|句子/i)) {
        result.fallback_content!.context_analysis =
          (result.fallback_content!.context_analysis || '') + line + ' '
      }
    } else if (currentSection === 'similar_words' && hasSimilarWordsSection) {
      // 提取近义词 (格式：英文 - 中文)
      const similarMatch = line.match(/^[\d\-\*\•]?\s*([a-zA-Z\s-]+)\s*[-–—]\s*(.+)$/)
      if (similarMatch) {
        result.fallback_content!.similar_words!.push({
          english: similarMatch[1].trim(),
          chinese: similarMatch[2].trim()
        })
      }
    }
  }

  // 清理数据
  result.fallback_content!.context_analysis =
    result.fallback_content!.context_analysis?.trim()

  return result
}

/**
 * 将解析的数据转换为 Markdown 格式
 */
function dataToMarkdown(data: ParsedWordData, word: string): string {
  let markdown = ''

  // 优先使用结构化数据
  if (data.sections) {
    // 常见含义部分
    if (data.sections.common_meanings?.items?.length) {
      const title = data.sections.common_meanings.title_template?.replace('#word_placeholder#', word) || `单词"${word}"的常见含义`
      markdown += `### 1. ${title}\n\n`
      data.sections.common_meanings.items.forEach(item => {
        const definition = typeof item === 'string' ? item : item.definition
        markdown += `- ${definition}\n`
      })
      markdown += '\n'
    }

    // 语境分析部分
    if (data.sections.context_analysis) {
      markdown += `### 2. ${data.sections.context_analysis.title}\n\n`
      markdown += `**句子：** "${data.sections.context_analysis.sentence}"\n\n`
      markdown += `${data.sections.context_analysis.analysis}\n\n`
    }

    // 近义词部分
    if (data.sections.similar_words?.items?.length) {
      markdown += `### 3. ${data.sections.similar_words.title}\n\n`
      data.sections.similar_words.items.forEach(item => {
        markdown += `- **${item.english}** - ${item.chinese}\n`
      })
    }
  }

  // 回退到非结构化数据
  if (!markdown && data.fallback_content) {
    const content = data.fallback_content

    // 含义部分
    if (content.meanings?.length) {
      markdown += `### 单词"${word}"的含义\n\n`
      content.meanings.forEach(meaning => {
        markdown += `- ${meaning}\n`
      })
      markdown += '\n'
    }

    // 语境分析部分
    if (content.context_analysis) {
      markdown += `### 语境分析\n\n`
      markdown += `${content.context_analysis}\n\n`
    }

    // 近义词部分
    if (content.similar_words?.length) {
      markdown += `### 近义词\n\n`
      content.similar_words.forEach(item => {
        markdown += `- **${item.english}** - ${item.chinese}\n`
      })
    }
  }

  // 如果都没有，返回原始文本（清理后）
  if (!markdown) {
    markdown = `无法解析响应内容，原始文本：\n\n${word}`
  }

  return markdown
}

/**
 * 主解析函数：使用渐进式回退机制
 */
export function parseWordResponse(text: string, word: string): ParseResult {
  console.debug('[Parser] Starting to parse response for word:', word)
  console.debug('[Parser] Original text:', text)

  // 1. 尝试标准 JSON 解析
  const jsonResult = enhancedJsonParse(text)
  if (jsonResult.success && jsonResult.data) {
    const data = jsonResult.data as ParsedWordData
    if (hasValidStructure(data)) {
      return {
        success: true,
        data,
        parse_method: jsonResult.repaired ? 'json_repaired' : 'json_strict',
        debug_info: jsonResult.repaired ? 'JSON was repaired before parsing' : 'Standard JSON parsing'
      }
    }
  }

  // 2. 尝试自然语言解析
  console.debug('[Parser] JSON parsing failed, trying natural language parsing')
  const naturalData = naturalLanguageParse(text, word)
  if (hasValidNaturalStructure(naturalData)) {
    return {
      success: true,
      data: naturalData,
      parse_method: 'natural_language',
      debug_info: 'Parsed using natural language extraction'
    }
  }

  // 3. 回退到原始文本
  console.debug('[Parser] All parsing methods failed, returning raw text')
  return {
    success: false,
    data: { word },
    parse_method: 'raw_text',
    error: jsonResult.error || 'Unable to parse response',
    debug_info: 'All parsing methods failed, returning original text'
  }
}

/**
 * 检查结构化数据是否有效
 */
function hasValidStructure(data: ParsedWordData): boolean {
  if (!data.sections) return false

  const { common_meanings, context_analysis, similar_words } = data.sections

  return (
    (common_meanings?.items?.length && common_meanings.items.length > 0) ||
    (context_analysis?.sentence && context_analysis.analysis) ||
    (similar_words?.items?.length && similar_words.items.length > 0)
  )
}

/**
 * 检查自然语言解析结果是否有效
 */
function hasValidNaturalStructure(data: ParsedWordData): boolean {
  if (!data.fallback_content) return false

  const { meanings, context_analysis, similar_words } = data.fallback_content

  return (
    (meanings && meanings.length > 0) ||
    (context_analysis && context_analysis.length > 10) ||
    (similar_words && similar_words.length > 0)
  )
}

/**
 * 将解析结果转换为 Markdown
 */
export function convertToMarkdown(result: ParseResult, word: string): string {
  if (result.success) {
    const markdown = dataToMarkdown(result.data, word)
    console.debug('[Parser] Markdown conversion successful, method:', result.parse_method)
    console.debug('[Parser] Generated markdown:', markdown)
    return markdown
  } else {
    console.warn('[Parser] Parsing failed, returning fallback content')
    return `无法解析响应内容，原始文本：\n\n${word}`
  }
}