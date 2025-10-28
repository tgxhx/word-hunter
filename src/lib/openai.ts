import { safeEmphasizeWordInText } from './index'
import { DEFAULT_SETTINGS, settings } from './settings'
import * as marked from 'marked'
import { parseWordResponse, convertToMarkdown } from './jsonParser'

function getHeaders() {
  const apiKey = settings().openai.apiKey
  return new Headers({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' })
}



export async function explainWord(word: string, context: string, model: string) {
  const headers = getHeaders()
  const useMarkdownRender = settings().openai.useMarkdownRender

  // Always use user's custom prompt with variable replacement
  const promptTemplate = settings().openai.prompt ?? DEFAULT_SETTINGS.openai.prompt
  const prompt = promptTemplate.replace('${word}', word).replace('${context}', context)

  // replace old model with new ones
  // https://platform.openai.com/docs/guides/text-generation
  if (model === 'text-davinci-003' || model === 'gpt-3.5-turbo-instruct') {
    model = 'gpt-3.5-turbo'
  }

  try {
    const url = settings().openai.apiProxy || DEFAULT_SETTINGS.openai.apiProxy
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || DEFAULT_SETTINGS.openai.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    })

    const json = await res.json()
    if (res.status === 401) {
      throw new Error('Invalid OpenAI API key. Please check your API key in the extension settings.')
    } else if (res.status !== 200) {
      throw json.error
    }
    const text = json.choices[0].message.content ?? ''
    const processedText = text.replace('\n\n', '\n').replaceAll('. ', '. \n\n')

    if (useMarkdownRender) {
      console.log('[Markdown Debug] Original AI response:', text)

      // Parse response using enhanced parser
      const parseResult = parseWordResponse(text, word)
      console.log('[Markdown Debug] Parse result:', parseResult)

      // Convert to Markdown
      const markdownText = convertToMarkdown(parseResult, word)
      console.log('[Markdown Debug] Converted Markdown:', markdownText)

      // Parse Markdown to HTML
      const markdownHtml = await marked.parse(markdownText)
      console.log('[Markdown Debug] Rendered HTML:', markdownHtml)

      // For Markdown rendering, we need to emphasize the word without escaping HTML
      const regex = new RegExp('(<.*>)?(' + word + ')(</.*>)?', 'gi')
      const emphasizedHtml = markdownHtml.replace(regex, `$1<b>$2</b>$3`)
      // Wrap in a div with markdown-content class for styling
      const wrappedHtml = `<div class="markdown-content">${emphasizedHtml}</div>`
      console.log('[Markdown Debug] Final HTML:', wrappedHtml)
      return wrappedHtml
    }

    return safeEmphasizeWordInText(processedText, word)
  } catch (e: any) {
    return e.message
  }
}
