import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env') })

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Say: API key works!' }]
  })
  console.log((msg.content[0] as { text: string }).text)
}

main().catch(err => { console.error(err.message); process.exit(1) })
