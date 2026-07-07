// Receipt scanning with Claude vision: photo of the bill in, structured
// {title, total, currency, items[]} out. Needs ANTHROPIC_API_KEY in .env.
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.BILL_SCAN_MODEL || 'claude-opus-4-8';

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_receipt', 'title', 'total', 'currency', 'items'],
  properties: {
    is_receipt: {
      type: 'boolean',
      description: 'true if the image actually shows a bill/receipt'
    },
    title: {
      type: 'string',
      description: 'Short human label for the meal, e.g. "Dinner — dakgalbi" or the restaurant name'
    },
    total: {
      type: 'number',
      description: 'Grand total actually payable, including tax/service charge'
    },
    currency: {
      type: 'string',
      description: 'ISO 4217 code, e.g. KRW, USD. Korean receipts with ₩ or 원 are KRW.'
    },
    items: {
      type: 'array',
      description: 'Line items. Empty if unreadable.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price', 'quantity'],
        properties: {
          name: { type: 'string', description: 'Item name, translated to English if Korean, keep original in parentheses' },
          price: { type: 'number', description: 'Total price for this line (unit price × quantity)' },
          quantity: { type: 'integer' }
        }
      }
    }
  }
};

export function scanAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function scanReceipt(filePath, mimeType) {
  if (!scanAvailable()) {
    throw new Error('ANTHROPIC_API_KEY not configured — add it to .env to enable receipt scanning.');
  }
  const client = new Anthropic();
  const data = fs.readFileSync(filePath).toString('base64');
  const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)
    ? mimeType
    : 'image/jpeg';

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          {
            type: 'text',
            text: 'Read this restaurant bill/receipt (it may be in Korean). Extract the grand total, currency, and line items. If the image is not a receipt, set is_receipt to false and leave items empty with total 0.'
          }
        ]
      }
    ]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to process this image.');
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No response text from model.');
  const parsed = JSON.parse(text);
  // Round money to 2dp; KRW to whole won
  const round = (n) => (parsed.currency === 'KRW' ? Math.round(n) : Math.round(n * 100) / 100);
  parsed.total = round(Number(parsed.total) || 0);
  parsed.items = (parsed.items || []).map((it) => ({ ...it, price: round(Number(it.price) || 0) }));
  return parsed;
}
