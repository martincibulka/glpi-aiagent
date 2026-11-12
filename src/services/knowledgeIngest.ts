import type { AppConfig, KnowledgeItem } from '../types.ts';
import { GLPIClient } from '../glpi/client.ts';
import { VectorStore } from '../ai/vectorStore.ts';
import { EmbeddingService } from '../ai/embeddings.ts';
import { cleanTicketDescription, stripHtml } from '../utils/text.ts';

export async function runIngestion(config: AppConfig, maxTickets = 200): Promise<void> {
  console.log('====================================================');
  console.log('  GLPI AI Agent – Indexácia vyriešených tiketov    ');
  console.log('====================================================');

  const glpi = new GLPIClient(config);
  const store = new VectorStore(config.dataDir);
  const embedder = new EmbeddingService(config);

  console.log(`[GLPI] Pripájanie k ${config.glpiUrl}...`);
  try {
    await glpi.initSession();
    console.log('[GLPI] Relácia úspešne inicializovaná.');
  } catch (err: any) {
    console.error(`[CHYBA] Nepodarilo sa pripojiť k GLPI: ${err.message}`);
    console.log('Skontrolujte prosím parametre GLPI_URL, GLPI_APP_TOKEN a GLPI_USER_TOKEN v súbore .env');
    return;
  }

  try {
    console.log(`[GLPI] Načítavam vyriešené/uzavreté tikety (max ${maxTickets})...`);
    const tickets = await glpi.getResolvedTickets(maxTickets, 0);
    console.log(`[GLPI] Nájdených ${tickets.length} vyriešených tiketov.`);

    let indexedCount = 0;
    let skippedCount = 0;

    for (const ticket of tickets) {
      if (store.hasTicket(ticket.id)) {
        skippedCount++;
        continue;
      }

      // Získame riešenie tiketu
      const solutions = await glpi.getTicketSolutions(ticket.id);
      let solutionText = '';

      if (solutions.length > 0) {
        // Zoberieme schválené alebo posledné riešenie
        solutionText = solutions.map((s) => stripHtml(s.content)).join('\n');
      } else {
        // Ak nemá formálne riešenie, skontrolujeme posledné followupy
        const followups = await glpi.getTicketFollowups(ticket.id);
        if (followups.length > 0) {
          const last = followups[followups.length - 1];
          solutionText = stripHtml(last.content);
        }
      }

      if (!solutionText || solutionText.trim().length < 10) {
        // Tiket nemá zmysluplné riešenie, preskočíme
        continue;
      }

      const problemText = cleanTicketDescription(ticket.content || ticket.name);

      // Text pre embedding: kombinácia názvu, problému a riešenia
      const textToEmbed = `Názov: ${ticket.name}\nProblém: ${problemText}\nRiešenie: ${solutionText}`;

      process.stdout.write(`Indexujem tiket #${ticket.id}: "${ticket.name.slice(0, 40)}"... `);
      const embedding = await embedder.getEmbedding(textToEmbed);

      const item: KnowledgeItem = {
        id: `glpi-${ticket.id}`,
        ticketId: ticket.id,
        title: ticket.name,
        problem: problemText,
        solution: solutionText,
        resolvedAt: ticket.solvedate || ticket.closedate || ticket.date,
        embedding,
      };

      store.add(item);
      indexedCount++;
      console.log('✓');
    }

    store.save();
    console.log('----------------------------------------------------');
    console.log(`Indexácia dokončená!`);
    console.log(`Nových zaindexovaných tiketov: ${indexedCount}`);
    console.log(`Preskočených (už v databáze): ${skippedCount}`);
    console.log(`Celkový počet záznamov v znalostnej báze: ${store.count()}`);
    console.log('----------------------------------------------------');
  } finally {
    await glpi.killSession();
  }
}
