import fs from 'fs';
import path from 'path';
import type { KnowledgeItem, SearchMatch } from '../types.ts';

/**
 * Rýchla lokálna vektorová databáza s perzistenciou do JSON súboru
 */
export class VectorStore {
  private filePath: string;
  private items: Map<string, KnowledgeItem> = new Map();

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, 'knowledge_base.json');
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: KnowledgeItem[] = JSON.parse(raw);
        for (const item of list) {
          this.items.set(item.id, item);
        }
      } catch (err) {
        console.warn(`[VectorStore] Nepodarilo sa načítať ${this.filePath}, vytvárame novú databázu.`);
      }
    }
  }

  public save(): void {
    const list = Array.from(this.items.values());
    fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
  }

  public add(item: KnowledgeItem): void {
    this.items.set(item.id, item);
  }

  public bulkAdd(newItems: KnowledgeItem[]): void {
    for (const item of newItems) {
      this.items.set(item.id, item);
    }
    this.save();
  }

  public hasTicket(ticketId: number): boolean {
    return this.items.has(`glpi-${ticketId}`);
  }

  public count(): number {
    return this.items.size;
  }

  public getAll(): KnowledgeItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Sémantické vyhľadávanie najpodobnejších tiketov pomocou kosínusovej podobnosti
   */
  public search(queryEmbedding: number[], topK = 3, minScore = 0.60): SearchMatch[] {
    const matches: SearchMatch[] = [];

    for (const item of this.items.values()) {
      if (!item.embedding || item.embedding.length === 0) continue;

      const sim = this.cosineSimilarity(queryEmbedding, item.embedding);
      if (sim >= minScore) {
        matches.push({ item, similarity: sim });
      }
    }

    // Zoradenie od najvyššej podobnosti
    matches.sort((a, b) => b.similarity - a.similarity);

    return matches.slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dot / denominator : 0;
  }
}
