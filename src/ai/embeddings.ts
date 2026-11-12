import type { AppConfig } from '../types.ts';

/**
 * Generovanie sémantických embeddingov cez Google Gemini alebo OpenAI
 */
export class EmbeddingService {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(768).fill(0);
    }

    if (this.config.aiProvider === 'gemini') {
      return this.getGeminiEmbedding(text);
    } else {
      return this.getOpenAIEmbedding(text);
    }
  }

  private async getGeminiEmbedding(text: string): Promise<number[]> {
    if (!this.config.geminiApiKey) {
      return this.getFallbackEmbedding(text);
    }

    const model = this.config.geminiEmbeddingModel || 'text-embedding-004';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.config.geminiApiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: {
          parts: [{ text }],
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Embedding API zlyhalo [${res.status}]: ${errText}`);
    }

    const json = (await res.json()) as { embedding?: { values: number[] } };
    if (!json.embedding || !json.embedding.values) {
      throw new Error('Neočakávaná odpoveď z Gemini Embedding API');
    }

    return json.embedding.values;
  }

  private async getOpenAIEmbedding(text: string): Promise<number[]> {
    if (!this.config.openaiApiKey) {
      return this.getFallbackEmbedding(text);
    }

    const url = 'https://api.openai.com/v1/embeddings';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiEmbeddingModel || 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Embedding API zlyhalo [${res.status}]: ${errText}`);
    }

    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    if (!json.data || !json.data[0] || !json.data[0].embedding) {
      throw new Error('Neočakávaná odpoveď z OpenAI Embedding API');
    }

    return json.data[0].embedding;
  }

  /**
   * Deterministický lokálny fallback hash (napr. pri mock/testovaní bez API kľúča)
   */
  private getFallbackEmbedding(text: string, dim = 768): number[] {
    const vec = new Array(dim).fill(0);
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash << 5) - hash + word.charCodeAt(i);
        hash |= 0;
      }
      const index = Math.abs(hash) % dim;
      vec[index] += 1;
    }

    // Normalizácia na jednotkovú dĺžku (L2 norm)
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }
}
